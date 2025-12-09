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
 * Inserts 100 rows and retrieves them with `eachRow()` with manual paging
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
            const query = "DROP TABLE IF EXISTS examples.eachRow";
            client.execute(query, next);
        },
        function createTable(next) {
            const query =
                "CREATE TABLE IF NOT EXISTS examples.eachRow (id uuid, txt text, val int, PRIMARY KEY(id))";
            client.execute(query, next);
        },
        async function insert(next) {
            // This can also be done concurrently to speed up this process.
            // Check `concurrent-executions` to how it can be done.
            const query =
                "INSERT INTO examples.eachRow (id, txt, val) VALUES (?, ?, ?)";
            for (let i = 0; i < 100; i++) {
                const id = cassandra.types.Uuid.random();
                await client.execute(query, [id, "Hello!", i], {
                    prepare: true,
                });
            }
            next();
        },
        function select(next) {
            const query = "SELECT id, txt, val FROM examples.eachRow";
            client.eachRow(
                query,
                [],
                { prepare: true, fetchSize: 10 },
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
                    console.log(`Per page callback -- ${result.rowLength}`);
                    if (err) {
                        throw err;
                    } else if (result.nextPage) {
                        result.nextPage();
                    } else {
                        next();
                    }
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
