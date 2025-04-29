"use strict";
const { randomBytes } = require("crypto");
const utils = require("../../lib/utils");

const { _Client } = require("../../main");
const cassandra = require(process.argv[2]);

const tableSchemaBasic = "CREATE TABLE benchmarks.basic (id uuid, val int, PRIMARY KEY(id))";
const singleStepCount = 1000000;

function getClientArgs() {
    return {
        contactPoints: [process.env.SCYLLA_URI ?? "172.17.0.2:9042"],
        localDataCenter: process.env.DATACENTER ?? "datacenter1",
    };
}

/**
 * 
 * @param {_Client} client 
 * @param {string} tableDefinition
 * @param {Function} next 
 */
async function prepareDatabase(client, tableDefinition, next) {
    await client.connect();

    // Keep replication one to reduce time spent in the database
    const query =
        "CREATE KEYSPACE IF NOT EXISTS benchmarks WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }";
    await client.execute(query);

    // Drop table to ensure no overhead comes from having already some data in the database
    const dropTable =
        "DROP TABLE IF EXISTS benchmarks.basic";
    await client.execute(dropTable);

    await client.execute(tableDefinition);

    next();
}

/**
 * 
 * @param {_Client} client 
 * @param {number} count 
 * @param {Function} next 
 * @returns 
 */
async function insertSimple(client, count, next) {
    let query =
        "INSERT INTO benchmarks.basic (id, val) VALUES (?, ?)";
    for (let i = 0; i < count; i++) {
        let id = cassandra.types.Uuid.random();
        try {
            await client.execute(query, [id, 100], { prepare: true });
        } catch (err) {
            return next(err);
        }
    }
    next();
}

/**
 * Call callback, each with up to singleStepCount
 * multiple times, so that sum of all called callback is equal to n
 * 
 * Introduced in order to limit memory usage of a single callback
 * @param {*} callback 
 * @param {*} n 
 */
async function repeatCapped(callback, n) {
    for (let rep = 0; rep * singleStepCount < n; rep++) {
        const finalStep = Math.min(n, (rep + 1) * singleStepCount);
        await callback(finalStep - rep * singleStepCount);
    }
}

async function executeMultipleRepeatCapped(callback, n, asyncLevel) {
    /**
     * @type {Array<Promise<_>>}
     */
    let promises = [];
    for (let c = 0; c < asyncLevel; c++) {
        promises.push(repeatCapped(callback, n));
    }
    for (let c = 0; c < asyncLevel; c++) {
        await promises[c];
    }
}




function insertDeSer(cassandra) {
    const id = cassandra.types.Uuid.random();
    const tuid = cassandra.types.TimeUuid.fromString("8e14e760-7fa8-11eb-bc66-000000000001");
    const ip = new cassandra.types.InetAddress(utils.allocBufferFromArray(randomBytes(4)));
    const date = cassandra.types.LocalDate.now();
    const time = cassandra.types.LocalTime.now();

    return [id, 100, tuid, ip, date, time];
}

function insertConcurrentDeSer(cassandra, n) {
    let allParameters = [];
    for (let i = 0; i < n; i++) {
        allParameters.push({
            query: "INSERT INTO benchmarks.basic (id, val, tuuid, ip, date, time) VALUES (?, ?, ?, ?, ?, ?)",
            params: insertDeSer(cassandra)
        });
    }
    return allParameters;
}

exports.insertDeSer = insertDeSer;
exports.tableSchemaBasic = tableSchemaBasic;
exports.getClientArgs = getClientArgs;
exports.prepareDatabase = prepareDatabase;
exports.insertConcurrentDeSer = insertConcurrentDeSer;
exports.repeatCapped = repeatCapped;
exports.executeMultipleRepeatCapped = executeMultipleRepeatCapped;
exports.insertSimple = insertSimple;
