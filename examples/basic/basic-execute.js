"use strict";
const cassandra = require("scylladb-driver-alpha");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

/**
 * Example using async/await syntax.
 */
async function example() {
    await client.connect();
    const result = await client.execute("SELECT * FROM system.local");
    const row = result.rows[0];
    console.log("Obtained row: ", row);
}

example().catch((err) => {
    console.error("There was an error", err);
});

// Exit on unhandledRejection
process.on("unhandledRejection", (reason) => {
    throw reason;
});
