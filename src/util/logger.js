'use strict';

const log4js = require('log4js');
const config = require('config');

function getLogger(category="log4js") {
    var logger = log4js.getLogger(category);
    logger.level = config.get('Logger.level');

    return logger;
}

module.exports = {
    getLogger: getLogger
}