'use strict';

const grpc                      = require('@grpc/grpc-js');
const assert                    = require('assert');
const config                    = require('config');
const logger                    = require('./util/extra').getLogger('MDS_SERVER');
const { v4: uuidv4 }            = require('uuid');
const { get_rpc_server, get_proto_descriptor }              = require('./util/grpc_util');
const { db_read, db_insert, db_update, db_remove }  = require('./util/db_util');

const CONFIG_ROOT = 'MetadataService'

var host      = config.get(`${CONFIG_ROOT}.hostConfig.host`);
var port      = config.get(`${CONFIG_ROOT}.hostConfig.port`);

var proto_descriptor    = get_proto_descriptor(config.get(`${CONFIG_ROOT}.protobuf_file`));
var proto_service       = proto_descriptor.metadata.MetadataService;


function join_cluster(call, callback) {
    /**
     * Receives request from a node to join the cluster.
     * Returns parent_node based on the stored whereabouts metadata.
     */

    var parent_record = null, node_record = {
        node_id: call.request.node_id || uuidv4(), // reuse/assign unique node id
        parent_id: "",    // new node has no parent
        depth: 1, // root depth is 1
        children_count: 0,
        capacity_left: call.request.capacity,
        endpoint_uri: call.getPeer() // <IP>:<PORT>
    }, parent_update_promise = Promise.resolve(true), node_insert_promise = Promise.resolve(true);

    logger.debug("New cluster join request from", call.getPeer());
    
    // pick parent with largest children count below its capacity
    var docs = db_read({ capacity_left: { $gt: 0 } }, { sort: { capacity_left: 1 }, limit: 1 });
    
    docs.then((result) => {
        if(!result.length) {
            logger.info("Cluster is empty. Assigned node to become root.");
        } else {
            parent_record = result[0];
            logger.info("Parent found for node", parent_record);
            
            node_record.parent_id = parent_record.node_id;
            node_record.depth = parent_record.depth + 1
            
            // update parent counters to add new children
            parent_update_promise = db_update({ node_id: parent_record.node_id }, // filter
                                              { $inc: { children_count: 1, capacity_left: -1 } });
        }
    
        node_insert_promise = db_insert(node_record);

        Promise.all([parent_update_promise, node_insert_promise]).then(() => {
            var response = {
                status: 200,
                node_id: node_record.node_id,
                depth: node_record.depth,
                message: 'Welcome aboard the Star Ship!',
                parent: {
                    node_id: "",
                    endpoint_uri: ""
                }
            };
            if(parent_record) {
                response.parent.node_id = node_record.parent_id;
                response.parent.endpoint_uri = parent_record.endpoint_uri; 
            }
            logger.debug("JoinClusterResponse: ", response);
            setTimeout(callback, 0, null, response);
        }).catch((err) => {
            logger.error("Error inserting/updating node/parent", err);
            return setTimeout(callback, 0, err);
        });
    
    }).catch((err) => {
        logger.error("Error fetching cluster nodes", err);
        return setTimeout(callback, 0, err);
    });
}

function publish_whereabouts(call, callback) {
    /**
     * Periodically receive and persist node's whereabouts. 
     */
    var updates = { depth: call.request.depth,
                    children_count: call.request.children_count,
                    parent_id: call.request.parent_id };
    
    logger.debug("Received whereabouts from node", call.getPeer(), call.request.node_id);
    logger.debug(updates);

    db_update(
                { node_id: call.request.node_id }, // filter
                { $set: updates }
            ).then(() => {
                setTimeout(callback, 0, null, { status: 200, message: "Whereabouts noted" });
            }).catch((err) => {
                logger.error("Error updating nodes whereabouts", err);
                setTimeout(callback, 0, err);
            });
}

(function() {
    var route_map = { 
        JoinCluster: join_cluster,
        PublishWhereabouts: publish_whereabouts
    }

    get_rpc_server(host, port, proto_service, route_map, (err, resp) => {
        assert.ifError(err);
        logger.info("MDS server started successfully!");
    });
})();