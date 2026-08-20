"use strict";
const cassandra = require("@scylladb/driver");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

/**
 * Creates a user-defined type and retrieves its metadata.
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples_udt WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute(
        "CREATE TYPE IF NOT EXISTS examples_udt.metadata_udt_example " +
            "(street text, city text, zip int)",
    );

    const udt = client.metadata.getUdt("examples_udt", "metadata_udt_example");

    console.log("UDT %s in keyspace %s:", udt.name, udt.keyspace);
    for (const field of udt.fields) {
        console.log("- %s: type code %d", field.name, field.type.code);
    }
}

example().catch(function (err) {
    console.error("There was an error", err);
    process.exitCode = 1;
});
