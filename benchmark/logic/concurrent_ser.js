"use strict";
const async = require("async");
// Possible values of argv[2] (driver) are scylladb-driver-alpha and cassandra-driver.
const cassandra = require(process.argv[2]);
const { getClientArgs, insertConcurrentDeSer } = require("./utils");
const { exit } = require("process");

const client = new cassandra.Client(getClientArgs());
const iterCnt = parseInt(process.argv[3]); 

async.series(
    [
        function connect(next) {
            client.connect(next);
        },
        function createKeyspace(next) {
            // Keep replication one to reduce time spent in the database
            const query =
                "CREATE KEYSPACE IF NOT EXISTS benchmarks WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }";
            client.execute(query, next);
        },
        // Drop table to ensure no overhead comes from having already some data in the database
        function dropTable(next) {
            const query =
                "DROP TABLE IF EXISTS benchmarks.basic";
            client.execute(query, next);
        },
        function createTable(next) {
            const query =
                "CREATE TABLE benchmarks.basic (id uuid, val int, tuuid timeuuid, ip inet, date date, time time, PRIMARY KEY(id))";
            client.execute(query, next);
        },
        async function insert(next) {
            let allParameters = insertConcurrentDeSer(cassandra, iterCnt * iterCnt);
            try {
                await cassandra.concurrent.executeConcurrent(client, allParameters, { prepare: true });
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

