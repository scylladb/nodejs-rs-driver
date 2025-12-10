"use strict";
const async = require("async");
// Possible values of argv[2] (driver) are scylladb-javascript-driver and cassandra-driver.
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
            let query =
                "INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)";
            for (let i = 0; i < 50; i++) {
                let id = cassandra.types.Uuid.random();
                try {
                    await client.execute(query, [id, 10], { prepare: true });
                } catch (err) {
                    return next(err);
                }
            }
            next();
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
                        assert.equal(s, 500);
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
    ],utils.onError);
