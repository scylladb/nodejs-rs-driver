"use strict";
const async = require("async");
// Possible values of argv[2] (driver) are scylladb-driver-alpha and cassandra-driver.
const cassandra = require(process.argv[2]);
const utils = require("./utils");
const { exit } = require("process");
const assert = require("assert");

const client = new cassandra.Client(utils.getClientArgs());
const iterCnt = parseInt(process.argv[3]);

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
                    const result = await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true, collectResults: true });
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
    ], function (err) {
        if (err) {
            console.error("Error: ", err.message, err.stack);
            exit(1);
        }
    },);
