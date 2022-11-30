'use strict';

const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config'); 

const {getServer, protoLoader, getLogger}  = require('./util/grpc_util');

const CONFIG_ROOT = 'MetadataService'

var host      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
var port      = config.get(`${CONFIG_ROOT}.hostConfig.port`);
var logger    = getLogger(config.get(`${CONFIG_ROOT}.name`));

var proto_descriptor    = protoLoader(config.get(`${CONFIG_ROOT}.protobuf_file`));
var proto_service       = proto_descriptor.metadata.MetadataService;

function join_cluster(call, callback) {
    /**
     * Receives node join request and returns suitable parent_node based on
     * the stored whereabouts metadata.
     */
    var response = {
        parent: {
            host: {
                hostname: "localhost"
            }
        }
    };

    logger.debug("JoinCluster called");
    
    callback(null, response);
}

function publish_whereabouts(call, callback) {
    /**
     * Periodically receive and persist node's whereabouts 
     */

    callback(null, null);
}

var route_map = { 
    JoinCluster: join_cluster,
    PublishWhereabouts: publish_whereabouts
}

function startServer() {
    getServer(host, port, proto_service, route_map, (err, resp) => {
        assert.ifError(err);
    });
}

startServer();