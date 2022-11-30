'use strict';

const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config'); 
const logger                    = require('./util/logger').getLogger('NODE_SERVER');

const {get_rpc_server, get_rpc_client, get_proto_descriptor }  = require('./util/grpc_util');

const CONFIG_ROOT = 'NodeService'

var host      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
var port      = config.get(`${CONFIG_ROOT}.hostConfig.port`);

var proto_descriptor    = get_proto_descriptor(config.get(`${CONFIG_ROOT}.protobuf_file`));
var proto_service       = proto_descriptor.node.NodeService;

var mds_descriptor = get_proto_descriptor(config.get(`MetadataService.protobuf_file`))
var metadata_client = get_rpc_client(mds_descriptor.metadata.MetadataService,
                                    'MetadataService');

var node_state; // singleton

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
}

function get_node_state(state) {
    if(node_state)
        return node_state;
    
    node_state = new NodeState(state.node_id, state.depth,
                                state.parent.endpoint_uri, state.parent.node_id);
    
    return node_state;
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

        metadata_client.JoinCluster({ capacity: 2 }, (_err, _resp) => {
            assert.ifError(_err);
            logger.debug(_resp);
            var node_obj = get_node_state(_resp);

            setInterval(node_obj.publish_whereabouts.bind(node_obj),
                        config.get(`${CONFIG_ROOT}.heartbeat_period`));
        });
    });
})();