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
            let limited = async function (steps) {
                let allParameters = [];
                for (let i = 0; i < steps; i++) {
                    allParameters.push({
                        query: 'INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)',
                        params: [cassandra.types.Uuid.random(), 10]
                    });
                }
                try {
                    const _result = await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true });
                } catch (err) {
                    return next(err);
                }
            }
            await utils.repeatCapped(limited, iterCnt);

            next();
        },
        async function test(next) {
            const query = "SELECT COUNT(1) FROM benchmarks.basic USING TIMEOUT 120s;";
            try {
                let res = await client.execute(query);
                assert(res.rows[0].count == iterCnt);
            } catch (err) {
                return next(err);
            }
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

