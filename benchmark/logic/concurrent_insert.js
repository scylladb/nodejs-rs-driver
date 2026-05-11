"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");

module.exports = function (cassandra, client, stepCount, concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCnt = stepCount || 4000000;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaBasic, next);
            },
            async function insert(next) {
                let limited = async function (steps) {
                    let allParameters = [];
                    for (let i = 0; i < steps; i++) {
                        allParameters.push({
                            query: 'INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)',
                            params: [cassandra.types.Uuid.random(), 10]
                        });
                    }
                    try {
                        const _result = await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true, concurrencyLevel });
                    } catch (err) {
                        return next(err);
                    }
                }
                await utils.repeatCapped(limited, iterCnt);

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
