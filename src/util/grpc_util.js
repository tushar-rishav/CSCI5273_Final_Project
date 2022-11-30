const grpc          = require('@grpc/grpc-js');
const path          = require('path');
const proto_loader  = require('@grpc/proto-loader');
const config        = require('config');

function get_proto_descriptor (proto_file) {
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

function get_rpc_server(host, port, proto_service, route_map, callback) {
    let server = new grpc.Server();
    
    server.addService(proto_service.service, route_map);
    server.bindAsync(`${host}:${port}`,
                        grpc.ServerCredentials.createInsecure(), (err, resp) => {
                        server.start();
                        setTimeout(callback, 0, err, resp)
                    });
}

function get_rpc_client(proto_service, service_name) {
    let host = config.get(`${service_name}.hostConfig.host`);
    let port = config.get(`${service_name}.hostConfig.port`);

    return new proto_service(`${host}:${port}`, grpc.credentials.createInsecure());
}


module.exports = {
    get_rpc_server: get_rpc_server,
    get_rpc_client: get_rpc_client,
    get_proto_descriptor: get_proto_descriptor
}