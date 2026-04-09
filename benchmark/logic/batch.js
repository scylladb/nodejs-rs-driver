"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");

module.exports = function (cassandra, client, stepCount, _concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCnt = stepCount || 3000000;
    // Experimentally determined max batch size that doesn't cause database error.
    const batchSize = 3971;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaBasic, next);
            },
            async function insert(next) {
                for (let z = 0; z * batchSize < iterCnt; z++) {
                    let queries = [];
                    for (let i = 0; i < Math.min(iterCnt - (z * batchSize), batchSize); i++) {
                        queries.push({
                            query: 'INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)',
                            params: [cassandra.types.Uuid.random(), 10]
                        });
                    }
                    try {
                        await client.batch(queries, { prepare: true });
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
