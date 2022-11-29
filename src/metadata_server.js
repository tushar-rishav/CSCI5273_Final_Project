const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config'); 

const {getServer, protoLoader, getLogger}  = require('./util/grpc_util');

const CONFIG_ROOT = 'MetadataService'
const HOST      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
const PORT      = config.get(`${CONFIG_ROOT}.hostConfig.port`);
const logger    = getLogger(config.get(`${CONFIG_ROOT}.name`));

var route_map = { 
    DiscoverParent: DiscoverParent
}

function startServer() {
    let proto_descriptor = protoLoader(config.get(`${CONFIG_ROOT}.protobuf_file`));
    let routeServer = getServer(proto_descriptor.metadata.MetadataService, route_map);

    routeServer.bindAsync(`${HOST}:${PORT}`,
                            grpc.ServerCredentials.createInsecure(), (err, port) => {
                                assert.ifError(err);
                                routeServer.start();
                            }
                        );
}

function DiscoverParent(call, callback) {
    var response = {
        parent: {
            host: {
                hostname: "localhost"
            }
        }
    };

    logger.debug("DiscoverParent called");
    
    callback(null, response);
}

startServer();