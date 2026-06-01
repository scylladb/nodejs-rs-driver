"use strict";
const cassandra = require("scylladb-driver-alpha");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

/**
 * Creates a table with a Tuple type, inserts a row and selects a row.
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute(
        "CREATE TABLE IF NOT EXISTS examples.tuple_forex " +
            "(name text, time timeuuid, currencies frozen<tuple<text, text>>, value decimal, PRIMARY KEY (name, time))",
    );

    console.log("Inserting");
    // Create a new instance of a Tuple
    const currencies = new cassandra.types.Tuple("USD", "EUR");
    const query =
        "INSERT INTO examples.tuple_forex (name, time, currencies, value)  VALUES (?, ?, ?, ?)";
    const params = [
        "market1",
        cassandra.types.TimeUuid.now(),
        currencies,
        new cassandra.types.BigDecimal(11, 1),
    ];
    await client.execute(query, params, { prepare: true });

    const result = await client.execute(
        "SELECT name, time, currencies, value FROM examples.tuple_forex where name = ?",
        ["market1"],
        { prepare: true },
    );

    const row = result.first();
    console.log(
        "%s to %s: %s",
        row["currencies"].get(0),
        row["currencies"].get(1),
        row["value"],
    );
}

example().catch(function (err) {
    console.error("There was an error", err);
});
