'use strict';

const {readFile, writeFile} = require('node:fs/promises');
const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config'); 
const {getLogger, deferPromise} = require('./util/extra');

var logger = getLogger('NODE_SERVER');


const {get_rpc_server, get_rpc_client, get_proto_descriptor }  = require('./util/grpc_util');

const CONFIG_ROOT = 'NodeService'

var host      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
var port      = config.get(`${CONFIG_ROOT}.hostConfig.port`);

var proto_descriptor    = get_proto_descriptor(config.get(`${CONFIG_ROOT}.protobuf_file`));
var proto_service       = proto_descriptor.node.NodeService;

var mds_descriptor = get_proto_descriptor(config.get(`MetadataService.protobuf_file`))
var metadata_client = get_rpc_client(mds_descriptor.metadata.MetadataService,
                                    'MetadataService');

class NodeState {
    constructor(node_id, depth, parent_endpoint, parent_id) {
        this.node_id = node_id;
        this.depth = depth;
        this.parent_endpoint = parent_endpoint || "";
        this.parent_id = parent_id || "";

        // children and siblings to be populated from peer discovery
        this.children = [];
        this.siblings = [];
    }

    // publish minimal ephemeral whereabouts metadata to metadata server
    publish_whereabouts() {
        let node_state = {
            node_id: this.node_id,
            parent_id: this.parent_id,
            depth: this.depth,
            children_count: this.children.length
        };

        metadata_client.PublishWhereabouts(node_state, (err, resp) => {
            if(err)
                logger.error("Error reported from PublishWhereabouts", err);
            else
                logger.debug(resp);
        });
    }

    static #cache_path = config.get(`${CONFIG_ROOT}.node_state_cache`);
    static #node_state; // singleton

    static persist_node_state(state) {
        // persist NodeState object to disk for failure recovery.
        var dfrd = deferPromise();

        writeFile(NodeState.#cache_path, JSON.stringify(state), { encoding: 'utf-8'}).then(() => {
            logger.debug("Node state persisted on disk");
            // dfrd.resolve(true);
        }).catch((err) => {
            logger.error("Error during persist_node_state", err);
            // dfrd.reject(err);
        });

        return dfrd.promise;
    }

    static if_old_state_exists() {
        // check if old NodeState object exsits
        var dfrd = deferPromise();

        readFile(NodeState.#cache_path, { encoding: 'utf-8'}).then((data) => {
            var prev_state = JSON.parse(data.toString());
            logger.info("Found previous node state", prev_state);

            dfrd.resolve(NodeState.get_node_state(prev_state));
        
        }).catch((err) => {
            dfrd.reject(err);
        });
        
        return dfrd.promise;
    }

    static get_node_state(state) {
        if(NodeState.#node_state)
            return NodeState.#node_state;
        
        NodeState.#node_state = new NodeState(state.node_id, state.depth,
                                             state.parent.endpoint_uri, state.parent.node_id);

        return NodeState.#node_state;
    }
}

function join_parent(call, callback) {
    var response = {};
    logger.debug("JoinParent called");
    callback(null, response);
}

function get_siblings_uncles(call, callback) {}

(function() {
    var route_map = { 
        JoinParent: join_parent,
        GetSiblingsUncles: get_siblings_uncles
    }

    get_rpc_server(host, port, proto_service, route_map, (err, resp) => {
        assert.ifError(err);

        NodeState.if_old_state_exists().then((node_obj) => {
            // send join parent request

            // setup publish whereabouts timer
            setInterval(node_obj.publish_whereabouts.bind(node_obj),
                        config.get(`${CONFIG_ROOT}.heartbeat_period`));
        }).catch((err)=>{
            logger.warn("Invalid old state", err.code);
            logger.info("Send new JoinCluster request");

            let node_capacity = config.get(`${CONFIG_ROOT}.capacity`)
            metadata_client.JoinCluster({ capacity: node_capacity }, (_err, _resp) => {
                assert.ifError(_err);
                logger.debug(_resp);
                // save to disk
                NodeState.persist_node_state(_resp);
                var node_obj = NodeState.get_node_state(_resp);

                // send join parent request

                // setup publish whereabouts request
                setInterval(node_obj.publish_whereabouts.bind(node_obj),
                            config.get(`${CONFIG_ROOT}.heartbeat_period`));
            });
        });
    });
})();