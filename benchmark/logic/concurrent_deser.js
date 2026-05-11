"use strict";
const async = require("async");
const utils = require("./utils");
const { exit } = require("process");
const assert = require("assert");

module.exports = function (cassandra, client, stepCount, concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    const iterCnt = stepCount || 2000;

    async.series(
        [
            function initialize(next) {
                utils.prepareDatabase(client, utils.tableSchemaDeSer, next);
            },
            async function insert(next) {
                let allParameters = utils.insertConcurrentDeSer(cassandra, iterCnt);
                try {
                    const _result = await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true, concurrencyLevel });
                } catch (err) {
                    return next(err);
                }
                next();
            },
            async function select(next) {
                let remaining = iterCnt;
                while (remaining > 0) {
                    let currentStep = Math.min(remaining, 500);
                    remaining -= currentStep;
                    let allParameters = [];
                    for (let i = 0; i < currentStep; i++) {
                        allParameters.push({
                            query: 'SELECT * FROM benchmarks.basic',
                        });
                    }
                    try {
                        const result = await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true, collectResults: true, concurrencyLevel });
                        for (let singleResult of result.resultItems) {
                            assert.equal(singleResult.rowLength, iterCnt);
                        }
                    } catch (err) {
                        return next(err);
                    }
                }
                next();
            },
            function r() {
                exit(0);
            }
        ], utils.onError);
};
