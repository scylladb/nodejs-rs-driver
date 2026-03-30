"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");
const assert = require("assert");

module.exports = function (cassandra, client, stepCount, concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCnt = stepCount || 400000;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaBasic, next);
            },
            async function insert(next) {
                utils.insertSimple(client, 10, next);
            },
            async function select(next) {
                let limited = async function (steps) {
                    let allParameters = [];
                    for (let i = 0; i < steps; i++) {
                        allParameters.push({
                            query: 'SELECT * FROM benchmarks.basic',
                        });
                    }
                    try {
                        const result = await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true, collectResults: true, concurrencyLevel });
                        for (let singleResult of result.resultItems) {
                            assert.equal(singleResult.rowLength, 10);
                        }
                    } catch (err) {
                        return next(err);
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
