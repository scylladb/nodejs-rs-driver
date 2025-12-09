"use strict";
const async = require("async");
// Possible values of argv[2] (driver) are scylladb-driver-alpha and cassandra-driver.
const cassandra = require(process.argv[2]);
const utils = require("./utils");
const { exit } = require("process");
const assert = require("assert");

const client = new cassandra.Client(utils.getClientArgs());
const iterCnt = parseInt(process.argv[3]);
// Expectantly determined max batch size, that doesn't cause database error.
const step = 3971;

async.series(
    [
        function initialize(next) {
            utils.prepareDatabase(client, utils.tableSchemaBasic, next);
        },
        async function insert(next) {
            // Limit batch size to step size
            for (let z = 0; z * step < iterCnt; z++) {
                let queries = [];
                for (let i = 0; i < Math.min(iterCnt - (z * step), step); i++) {
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
