"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");

module.exports = function (cassandra, client, stepCount, _concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCnt = stepCount || 400000;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaBasic, next);
            },
            async function insert(next) {
                for (let i = 0; i < iterCnt; i++) {
                    const id = cassandra.types.Uuid.random();
                    const query =
                        "INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)";
                    try {
                        await client.execute(query, [id, 100], { prepare: true });
                    } catch (err) {
                        return next(err);
                    }
                }
                next();
            },
            async function test(next) {
                utils.checkRowCount(client, iterCnt, next);
            },
            function r() {
                exit(0);
            }
        ], utils.onError);
};
