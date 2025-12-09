"use strict";
const cassandra = require("scylladb-driver-alpha");
const { getClientArgs } = require("../util");
const async = require("async");

const client = new cassandra.Client(getClientArgs());

/**
 * Example using async library for avoiding nested callbacks
 * See https://github.com/caolan/async
 * Alternately you can use the Promise-based API.
 *
 * Inserts 100 rows and retrieves them with `eachRow()` with automatic paging
 */

async.series(
    [
        function connect(next) {
            client.connect(next);
        },
        function createKeyspace(next) {
            const query =
                "CREATE KEYSPACE IF NOT EXISTS examples WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }";
            client.execute(query, next);
        },
        function dropTable(next) {
            const query = "DROP TABLE IF EXISTS examples.autoPaged";
            client.execute(query, next);
        },
        function createTable(next) {
            const query =
                "CREATE TABLE IF NOT EXISTS examples.autoPaged (id uuid, txt text, val int, PRIMARY KEY(id))";
            client.execute(query, next);
        },
        async function insert(next) {
            // This can also be done concurrently to speed up this process.
            // Check `concurrent-executions` to how it can be done.
            const query =
                "INSERT INTO examples.autoPaged (id, txt, val) VALUES (?, ?, ?)";
            for (let i = 0; i < 100; i++) {
                const id = cassandra.types.Uuid.random();
                await client.execute(query, [id, "Hello!", i], {
                    prepare: true,
                });
            }
            next();
        },
        function select(next) {
            const query = "SELECT id, txt, val FROM examples.autoPaged";
            client.eachRow(
                query,
                [],
                { prepare: true, autoPage: true, fetchSize: 10 },
                /**
                 * @param {cassandra.types.Row} result
                 */
                function (index, result) {
                    console.log(
                        `Per row callback: ${index} ${result.values()}`,
                    );
                },
                /**
                 * @param {cassandra.types.ResultSet} result
                 */
                function (err, result) {
                    if (err) {
                        throw err;
                    }
                    console.log(
                        `Callback at the end of all queries -- ${result.rowLength}`,
                    );
                    next();
                },
            );
        },
    ],
    function (err) {
        if (err) {
            console.error("There was an error", err.message, err.stack);
        }
    },
);
