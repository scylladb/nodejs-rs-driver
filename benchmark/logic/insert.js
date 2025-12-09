"use strict";
const async = require("async");
// Possible values of argv[2] (driver) are scylladb-driver-alpha and cassandra-driver.
const cassandra = require(process.argv[2]);
const utils = require("./utils");
const { exit } = require("process");

const client = new cassandra.Client(utils.getClientArgs());
const iterCnt = parseInt(process.argv[3]);

async.series(
    [
        function initialize(next) {
            utils.prepareDatabase(client, utils.tableSchemaBasic, next);
        },
        async function insert(next) {
            for (let i = 0; i < iterCnt; i++) {
                const id = cassandra.types.Uuid.random();
                const query =
                    "INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)";
                try {
                    await client.execute(query, [id, 100], { prepare: true });
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
    ],
    function (err) {
        if (err) {
            console.error("There was an error", err.message, err.stack);
            exit(1);
        }

    },
);

