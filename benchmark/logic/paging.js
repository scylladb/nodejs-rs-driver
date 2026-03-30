"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");
const assert = require("assert");

module.exports = function (cassandra, client, stepCount, _concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCnt = stepCount || 4000;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaBasic, next);
            },
            async function insert(next) {
                utils.insertSimple(client, 50, next);
            },
            async function select(next) {
                let limited = async function (steps) {
                    for (let i = 0; i < steps; i++) {
                        try {
                            let s = 0;
                            let q = await client.execute('SELECT * FROM benchmarks.basic', [], { prepare: true, fetchSize: 1 });
                            for await (const row of q) {
                                s += row['val'];
                            }
                            assert.equal(s, 5000);
                        } catch (err) {
                            return next(err);
                        }
                    }
                }
                await utils.repeatCapped(limited, iterCnt);
                next();
            },
            function r() {
                exit(0);
            }
        ], utils.onError);
};
