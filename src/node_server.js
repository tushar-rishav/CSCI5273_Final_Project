'use strict';

const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config'); 
const logger                    = require('./util/logger').getLogger('NODE_SERVER');

const {getServer, getClient, protoLoader }  = require('./util/grpc_util');

const CONFIG_ROOT = 'NodeService'

var host      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
var port      = config.get(`${CONFIG_ROOT}.hostConfig.port`);

var proto_descriptor    = protoLoader(config.get(`${CONFIG_ROOT}.protobuf_file`));
var proto_service       = proto_descriptor.node.NodeService;

var mds_descriptor = protoLoader(config.get(`MetadataService.protobuf_file`))
var metadata_client = getClient(mds_descriptor.metadata.MetadataService,
                                'MetadataService');


function join_parent(call, callback) {
    var response = {};
    logger.debug("JoinParent called");
    callback(null, response);
}

function get_siblings_uncles(call, callback) {

}

var route_map = { 
    JoinParent: join_parent,
    GetSiblingsUncles: get_siblings_uncles
}

function startServer() {
    
    getServer(host, port, proto_service, route_map, (err, resp) => {
        assert.ifError(err);

        metadata_client.JoinCluster({ capacity: 2 }, (_err, _resp) => {
            assert.ifError(_err);
            logger.debug(_resp);
        });
    });
}

startServer();