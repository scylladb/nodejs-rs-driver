"use strict";
const cassandra = require("scylladb-driver-alpha");
const { getClientArgs } = require("../util");
const assert = require("assert");

const client = new cassandra.Client(getClientArgs());

/**
 * Example using async/await syntax.
 *
 * Inserts a row and retrieves a row
 */
async function example() {
    const id = cassandra.types.Uuid.random();

    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '3' }",
    );

    await client.execute(
        "CREATE TABLE IF NOT EXISTS examples.basic (id uuid, txt text, val int, PRIMARY KEY(id))",
    );

    await client.execute(
        "INSERT INTO examples.basic (id, txt, val) VALUES (?, ?, ?)",
        [id, "Hello!", 100],
        { prepare: true },
    );

    const result = await client.execute(
        "SELECT id, txt, val FROM examples.basic WHERE id = ?",
        [id],
        { prepare: true },
    );

    const row = result.first();
    console.log("Obtained row: ", row);
    assert.strictEqual(row.id.toString(), id.toString());
    assert.strictEqual(row.txt, "Hello!");
    assert.strictEqual(row.val, 100);

    console.log("Shutting down");
}

example().catch(function (err) {
    console.error("There was an error", err.message, err.stack);
});
