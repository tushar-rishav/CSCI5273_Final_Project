const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config'); 

const {getServer, getClient, protoLoader, getLogger}  = require('./util/grpc_util');

const CONFIG_ROOT = 'NodeService'
const HOST      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
const PORT      = config.get(`${CONFIG_ROOT}.hostConfig.port`);
const logger    = getLogger(config.get(`${CONFIG_ROOT}.name`));


var mds_descriptor = protoLoader(config.get(`MetadataService.protobuf_file`))
var metadata_client = getClient(mds_descriptor.metadata.MetadataService,
                                'MetadataService');

var route_map = { 
    JoinParent: JoinParent
}

function startServer() {
    let proto_descriptor = protoLoader(config.get(`${CONFIG_ROOT}.protobuf_file`));
    let routeServer = getServer(proto_descriptor.node.NodeService, route_map);

    routeServer.bindAsync(`${HOST}:${PORT}`,
                            grpc.ServerCredentials.createInsecure(), (err, port) => {
                                assert.ifError(err);
                                routeServer.start();
                                
                                metadata_client.DiscoverParent({}, {}, (_err, resp) => {
                                    assert.ifError(_err);
                                    logger.debug(resp);
                                })
                            }
                        );
}

function JoinParent(call, callback) {
    var response = {};
    logger.debug("JoinParent called");
    callback(null, response);
}

startServer();