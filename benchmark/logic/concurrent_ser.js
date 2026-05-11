"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");

module.exports = function (cassandra, client, stepCount, concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCnt = stepCount || 1200;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaDeSer, next);
            },
            async function insert(next) {
                let allParameters = utils.insertConcurrentDeSer(cassandra, iterCnt * iterCnt);
                try {
                    await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true, concurrencyLevel });
                } catch (err) {
                    return next(err);
                }
                next();
            },
            async function test(next) {
                utils.checkRowCount(client, iterCnt * iterCnt, next);
            },
            function r() {
                exit(0);
            }
        ], utils.onError);
};
