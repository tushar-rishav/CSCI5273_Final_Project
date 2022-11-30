'use strict';

const { MongoClient, ObjectId }  = require('mongodb');
const logger = require('./logger').getLogger('DB_UTIL');

const COLLECTION = "metadata";
var URL = process.env.ME_CONFIG_MONGODB_URL;
var DBO;

const db_client = new MongoClient(URL);

function db_connect() {
    db_client.connect().then(
        () => {
            db_client.db("admin").command({ping: 1});
            DBO = db_client.db("mds");
        }
    ).catch(
        (err) => {
            logger.error(err);
            setTimeout(process.exit, 0, 2);
        }
    )
}

db_connect();

function insert(doc) {
    return DBO.collection(COLLECTION).insertOne(doc);
}

function read(query, option, to_array=true) {
    var cursor = DBO.collection(COLLECTION).find(query, option);
    var result;

    if(to_array)
        return cursor.toArray();

    return cursor;
}

function remove(doc) {

}

function update(filter, update_doc) {
    return DBO.collection(COLLECTION).updateOne(filter, update_doc);
}

module.exports = {
    db_insert: insert,
    db_read: read,
    db_update: update,
    db_remove: remove
}
