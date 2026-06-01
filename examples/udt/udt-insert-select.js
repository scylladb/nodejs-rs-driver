"use strict";
const cassandra = require("scylladb-driver-alpha");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

const uniqueName = `The Rolling Stones ${Date.now()}-${Math.random()}`; // Unique primary key

/**
 * Creates a table with a user-defined type, inserts a row and selects a row.
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute(
        "CREATE TYPE IF NOT EXISTS examples.address " +
            "(street text, city text, state text, zip int, phones set<text>)",
    );

    await client.execute(
        "CREATE TABLE IF NOT EXISTS examples.udt_tbl1 " +
            "(name text PRIMARY KEY, email text, address frozen<address>)",
    );

    console.log("Inserting");
    const address = {
        city: "Santa Clara",
        state: "CA",
        street: "3975 Freedom Circle",
        zip: 95054,
        phones: ["650-389-6000"],
    };
    await client.execute(
        "INSERT INTO examples.udt_tbl1 (name, address) VALUES (?, ?)",
        [uniqueName, address],
        { prepare: true },
    );

    const result = await client.execute(
        "SELECT name, address FROM examples.udt_tbl1 WHERE name = ?",
        [uniqueName],
        { prepare: true },
    );

    const row = result.first();
    console.log(`Retrieved row: ${row}`);
}

example().catch(function (err) {
    console.error(`There was an error ${err}`);
});
