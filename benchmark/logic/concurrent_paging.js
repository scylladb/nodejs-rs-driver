"use strict";
const async = require("async");
// Possible values of argv[2] (driver) are scylladb-nodejs-rs-driver and cassandra-driver.
const cassandra = require(process.argv[2]);
const utils = require("./utils");
const { exit } = require("process");
const { assert } = require("console");

const client = new cassandra.Client(utils.getClientArgs());
const iterCnt = parseInt(process.argv[3]);
const concurrencyLevel = 20;

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
                        assert(s === 5000);
                    } catch (err) {
                        return next(err);
                    }

                }
            }
            await utils.executeMultipleRepeatCapped(limited, iterCnt, concurrencyLevel);
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
