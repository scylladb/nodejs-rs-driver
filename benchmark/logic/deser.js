"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");

module.exports = function (cassandra, client, stepCount, _concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCount = stepCount || 2000;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaDeSer, next);
            },
            async function insert(next) {
                utils.executeInsertDeSer(client, iterCount, cassandra, next);
            },
            async function query(next) {
                await utils.queryWithRowCheck(client, iterCount, iterCount, next);
            },
            function r() {
                exit(0);
            }
        ], utils.onError);
};
