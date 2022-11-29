const grpc          = require('@grpc/grpc-js');
const path          = require('path');
const proto_loader  = require('@grpc/proto-loader');
const config        = require('config');
const log4js        = require('log4js');

function protoLoader (proto_file) {
    let proto_path = path.join(process.cwd(), config.get('Proto.base_dir'), proto_file);

    let package_definition = proto_loader.loadSync(
        proto_path,
        {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true
        }
    );
    let proto_descriptor = grpc.loadPackageDefinition(package_definition);

    return proto_descriptor
}

function getServer(proto_service, route_map) {
    let server = new grpc.Server();
    server.addService(proto_service.service, route_map);
    
    return server;
}

function getClient(proto_service, service_name) {
    let host = config.get(`${service_name}.hostConfig.host`);
    let port = config.get(`${service_name}.hostConfig.port`);

    return new proto_service(`${host}:${port}`, grpc.credentials.createInsecure());
}

function getLogger(category="log4js") {
    var logger = log4js.getLogger(category);
    logger.level = config.get('Logger.level');

    return logger;
}


module.exports = {
    getLogger: getLogger,
    getServer: getServer,
    getClient: getClient,
    protoLoader: protoLoader
}