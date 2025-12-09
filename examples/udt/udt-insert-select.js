"use strict";
const cassandra = require("scylladb-driver-alpha");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

const uniqueName = `The Rolling Stones ${Date.now()}-${Math.random()}`; // Unique primary key

/**
 * Creates a table with a user-defined type, inserts a row and selects a row.
 */
client
    .connect()
    .then(function () {
        const query =
            "CREATE KEYSPACE IF NOT EXISTS examples WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }";
        return client.execute(query);
    })
    .then(function () {
        const query =
            "CREATE TYPE IF NOT EXISTS examples.address " +
            "(street text, city text, state text, zip int, phones set<text>)";
        return client.execute(query);
    })
    .then(function () {
        const query =
            "CREATE TABLE IF NOT EXISTS examples.udt_tbl1 " +
            "(name text PRIMARY KEY, email text, address frozen<address>)";
        return client.execute(query);
    })
    .then(function () {
        console.log("Inserting");
        const address = {
            city: "Santa Clara",
            state: "CA",
            street: "3975 Freedom Circle",
            zip: 95054,
            phones: ["650-389-6000"],
        };
        const query =
            "INSERT INTO examples.udt_tbl1 (name, address) VALUES (?, ?)";
        return client.execute(query, [uniqueName, address], {
            prepare: true,
        });
    })
    .then(function () {
        const query =
            "SELECT name, address FROM examples.udt_tbl1 WHERE name = ?";
        return client.execute(query, [uniqueName], { prepare: true });
    })
    .then(function (result) {
        const row = result.first();
        console.log(`Retrieved row: ${row}`);
    })
    .catch(function (err) {
        console.error(`There was an error ${err}`);
    });
