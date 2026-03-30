"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");

function selectWithRows(cassandra, client, rowCount, stepCount) {
    const iterCnt = stepCount;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaBasic, next);
            },
            async function insert(next) {
                utils.insertSimple(client, rowCount, next);
            },
            async function query(next) {
                await utils.queryWithRowCheck(client, rowCount, iterCnt, next);
            },
            function r() {
                exit(0);
            }
        ], utils.onError);
}

module.exports = selectWithRows;
