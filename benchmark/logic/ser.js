"use strict";
const async = require("async");
// Possible values of argv[2] (driver) are scylladb-driver-alpha and cassandra-driver.
const cassandra = require(process.argv[2]);
const utils = require("./utils");
const { exit } = require("process");

const client = new cassandra.Client(utils.getClientArgs());
const iterCount = parseInt(process.argv[3]);

async.series(
    [
        function initialize(next) {
            utils.prepareDatabase(client, utils.tableSchemaDeSer, next);
        },
        async function insert(next) {
            utils.executeInsertDeSer(client, iterCount * iterCount, cassandra, next);
        },
        async function test(next) {
            utils.checkRowCount(client, iterCount * iterCount, next);
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

