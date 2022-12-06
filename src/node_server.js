'use strict';

const {readFile, writeFile} = require('node:fs/promises');
const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config'); 
const NodeCache                 = require( "node-cache" );
const {getLogger, deferPromise} = require('./util/extra');

var logger = getLogger('NODE_SERVER');


const {get_rpc_server, get_rpc_client, get_proto_descriptor }  = require('./util/grpc_util');

const CONFIG_ROOT = 'NodeService'

var host      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
var port      = config.get(`${CONFIG_ROOT}.hostConfig.port`);

var mds_host  = config.get(`MetadataService.hostConfig.host`);
var mds_port  = config.get(`MetadataService.hostConfig.port`);

var proto_descriptor    = get_proto_descriptor(config.get(`${CONFIG_ROOT}.protobuf_file`));
var proto_service       = proto_descriptor.node.NodeService;

var mds_descriptor = get_proto_descriptor(config.get(`MetadataService.protobuf_file`))
var metadata_client = get_rpc_client(mds_descriptor.metadata.MetadataService,
                                     `${mds_host}:${mds_port}`);

class NodeState {
    constructor(node_id, depth, parent_endpoint, parent_id) {
        this.node_id = node_id;
        this.depth = depth;
        this.parent_endpoint = parent_endpoint || "";
        this.parent_id = parent_id || "";

        // The children and siblings to be populated from peer discovery
        // Cache stored as node_id -> Node(node_id, endpoint_uri)
        this.children = new NodeCache({ maxKeys: config.get(`${CONFIG_ROOT}.capacity`) });
        this.siblings = new NodeCache();
        this.uncles   = new NodeCache();
    }

    // publish minimal ephemeral whereabouts metadata to metadata server
    publish_whereabouts() {
        var self = this;
        let node_state = {
            node_id: self.node_id,
            parent_id: self.parent_id,
            depth: self.depth,
            children_count: self.children.keys().length
        };
        logger.info("Publish node_state: ", node_state);
        metadata_client.PublishWhereabouts(node_state, (err, resp) => {
            if(err)
                logger.error("Error reported from PublishWhereabouts", err);
        });
    }

    set_siblings_uncles_response (response, child_node_id) {
        // uncles for child node
        var self = this;
        self.siblings.keys().forEach((node_id) => {
            response.uncles.push({ node_id: node_id,
                                   endpoint_uri: self.siblings.get(node_id).endpoint_uri })
        });
        // siblings for child node
        self.children.keys().forEach((node_id) => {
            if(node_id != child_node_id) { // filter only siblings
                response.siblings.push({ node_id: node_id,
                                         endpoint_uri: self.children.get(node_id).endpoint_uri })
            }
        });
    }

    update_uncles_and_siblings (siblings_and_uncles) {
        var self = this;
        self.siblings = new NodeCache();
        self.uncles = new NodeCache();
        siblings_and_uncles.siblings.forEach((node) => {
            self.siblings.set(node.node_id, node);
        });

        siblings_and_uncles.uncles.forEach((node) => {
            self.uncles.set(node.node_id, node);
        });
    }

    static parent_rpc_client;
    static #cache_path = config.get(`${CONFIG_ROOT}.node_state_cache`);
    static #node_state; // singleton

    join_parent(cluster_resp) {
        var self = this;

        // check if node itself is the root
        if(self.parent_id == ""){
            logger.info("Root has no join parent request", self.node_id, self.parent_id);
            return;
        }

        // send join request to the assigned parent
        // cluster_resp.parent.endpoint_uri
        var parent_ip = cluster_resp.parent.endpoint_uri.split(':')[0];
        var parent_uri = `${parent_ip}:${port}`;
        logger.debug("Sending JoinParent request to: ", parent_uri);
        NodeState.parent_rpc_client = get_rpc_client(proto_service, parent_uri);
        NodeState.parent_rpc_client.JoinParent({ child: { node_id: NodeState.#node_state.node_id }},
            (err, resp) => {
                if(err && err.message == "CAP_FULL") {
                    logger.error("Parent join failed as parent is full.");
                    // FIXME: join cluster; request new parent from MDS
                }
                assert.ifError(err);
                logger.info("Join parent successful", NodeState.#node_state.parent_id, resp);

                self.update_uncles_and_siblings(resp.siblings_and_uncles);
                setInterval(self.get_siblings_and_uncles.bind(self),
                            config.get(`${CONFIG_ROOT}.heartbeat_period`));
                
        });
    }

    get_siblings_and_uncles() {
        var self = this;
        
        // check if node itself is the root
        if(self.parent_id == "") return;

        // send join request to the assigned parent

        NodeState.parent_rpc_client.GetSiblingsAndUncles({ node_id: NodeState.#node_state.node_id },
            (err, resp) => {
                assert.ifError(err);
                logger.info("Fetched recent siblings and uncles for node_id: ", NodeState.#node_state.node_id, resp);

                self.update_uncles_and_siblings(resp);
        });
    }

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

            dfrd.resolve(prev_state);
        
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

function rpc_add_child_node(call, callback) {
    var node_state = NodeState.get_node_state();
    var new_child = call.request.child;

    new_child.endpoint_uri = new_child.endpoint_uri || call.getPeer();

    logger.debug("JoinParent called from child", new_child.node_id, new_child.endpoint_uri);
    try{
        if( node_state.children.set(new_child.node_id, new_child) ){
            logger.info("Children list:", node_state.children.keys());
            var response = { status: 200,
                             message: 'SUCCESS',
                             siblings_and_uncles: { siblings: [], uncles: [] } 
                            };

            node_state.set_siblings_uncles_response(response.siblings_and_uncles, new_child.node_id);

            setTimeout(callback, 0, null, response);
        }
    } catch(error){ // capacity full: reject new child
        logger.warn("Failed to add new child", error);
        setTimeout(callback, 0, { status: 500, message: 'CAP_FULL' });
    }
}

function rpc_get_siblings_uncles(call, callback) {
    var node_state = NodeState.get_node_state();
    var response = { siblings: [], uncles: [] };
    var child_node_id = call.request.node_id;

    node_state.set_siblings_uncles_response(response, child_node_id);
    setTimeout(callback, 0, null, response);
}

(function() {
    var route_map = {
        JoinParent: rpc_add_child_node,
        GetSiblingsAndUncles: rpc_get_siblings_uncles
    }

    get_rpc_server(host, port, proto_service, route_map, (err, resp) => {
        assert.ifError(err);

        NodeState.if_old_state_exists().then((node_state_json) => {
            // send join parent request
            var node_obj = NodeState.get_node_state(node_state_json);
            setTimeout(node_obj.join_parent.bind(node_obj), 0, node_state_json);

            // setup publish whereabouts timer
            setInterval(node_obj.publish_whereabouts.bind(node_obj),
                        config.get(`${CONFIG_ROOT}.heartbeat_period`));
        }).catch((err)=>{
            logger.warn("Invalid old state", err.code);
            logger.info("Send new JoinCluster request");

            let node_capacity = config.get(`${CONFIG_ROOT}.capacity`);
            metadata_client.JoinCluster({ capacity: node_capacity }, (_err, _resp) => {
                assert.ifError(_err);
                logger.debug(_resp);
                // save to disk
                NodeState.persist_node_state(_resp);
                var node_obj = NodeState.get_node_state(_resp);

                // send join parent request
                setTimeout(node_obj.join_parent.bind(node_obj), 0, _resp);

                // setup publish whereabouts request
                setInterval(node_obj.publish_whereabouts.bind(node_obj),
                            config.get(`${CONFIG_ROOT}.heartbeat_period`));
            });
        });
    });
})();