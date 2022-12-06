'use strict';

const log4js = require('log4js');
const config = require('config');

function getLogger(category="log4js") {
    var logger = log4js.getLogger(category);
    logger.level = config.get('Logger.level');

    return logger;
}

function deferPromise() {
    var resolve, reject;
    var promise = new Promise(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
}

module.exports = {
    getLogger: getLogger,
    deferPromise: deferPromise
}