'use strict';

const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config');
const logger                    = require('./util/logger').getLogger('MDS_SERVER');
const { v4: uuidv4 }            = require('uuid');
const { getServer, protoLoader }    = require('./util/grpc_util');
const { db_read, db_insert, db_update, db_remove } = require('./util/db_util');

const CONFIG_ROOT = 'MetadataService'

var host      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
var port      = config.get(`${CONFIG_ROOT}.hostConfig.port`);

var proto_descriptor    = protoLoader(config.get(`${CONFIG_ROOT}.protobuf_file`));
var proto_service       = proto_descriptor.metadata.MetadataService;

function join_cluster(call, callback) {
    /**
     * Receives node join request and returns suitable parent_node based on
     * the stored whereabouts metadata.
     */

    var parent_record = null, node_record = {
        node_uuid: uuidv4(),
        parent_uuid: "",
        depth: 1, // root depth is 1
        children_count: 0,
        capacity_left: call.request.capacity,
        endpoint_uri: call.getPeer() // <IP>:<PORT>
    }, parent_update_promise = Promise.resolve(1), node_insert_promise = Promise.resolve(1);

    logger.debug("New cluster join request from", call.getPeer());
    
    // pick parent with largest children count below its capacity
    var docs = db_read({ capacity_left: { $gt: 0 } }, { sort: { capacity_left: 1 }, limit: 1 });
    
    docs.then((result) => {
        if(!result.length) {
            logger.info("Cluster is empty. Assigned node to become root.");
        } else {
            parent_record = result[0];
            logger.info("Parent found for node", parent_record);
            
            node_record.parent_uuid = parent_record.node_uuid;
            node_record.depth = parent_record.depth + 1
            
            parent_update_promise = db_update({ node_uuid: parent_record.node_uuid }, // filter
                                              { $inc: { children_count: 1, capacity_left: -1 } });
        }
    
        node_insert_promise = db_insert(node_record);
    
    }).catch((err) => {
        logger.error("Error fetching cluster nodes", err);
        return setTimeout(callback, 0, err);
    });

    Promise.all([parent_update_promise, node_insert_promise]).then(() => {
        var response = {
            status: 200,
            message: 'Welcome aboard the Star Ship!',
            parent: {
                id: "",
                host: { endpoint_uri: "" }
            }
        };
        if(parent_record) {
            response.parent.id = node_record.parent_uuid;
            response.parent.host.endpoint_uri = parent_record.endpoint_uri; 
        }
        setTimeout(callback, 0, null, response);
    }).catch((err) => {
        logger.error("Error inserting/updating node/parent", err);
        return setTimeout(callback, 0, err);
    });
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