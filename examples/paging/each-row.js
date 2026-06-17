"use strict";
const cassandra = require("@scylladb/driver");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

/**
 * Example using async/await syntax.
 *
 * Inserts 100 rows and retrieves them with `eachRow()` with manual paging
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute("DROP TABLE IF EXISTS examples.eachRow");

    await client.execute(
        "CREATE TABLE IF NOT EXISTS examples.eachRow (id uuid, txt text, val int, PRIMARY KEY(id))",
    );

    // This can also be done concurrently to speed up this process.
    // Check `concurrent-executions` to how it can be done.
    const insertQuery =
        "INSERT INTO examples.eachRow (id, txt, val) VALUES (?, ?, ?)";
    for (let i = 0; i < 100; i++) {
        const id = cassandra.types.Uuid.random();
        await client.execute(insertQuery, [id, "Hello!", i], {
            prepare: true,
        });
    }

    await new Promise(function (resolve, reject) {
        client.eachRow(
            "SELECT id, txt, val FROM examples.eachRow",
            [],
            { prepare: true, fetchSize: 10 },
            /**
             * @param {cassandra.types.Row} result
             */
            function (index, result) {
                console.log(`Per row callback: ${index} ${result.values()}`);
            },
            /**
             * @param {cassandra.types.ResultSet} result
             */
            function (err, result) {
                if (err) {
                    return reject(err);
                }
                console.log(`Per page callback -- ${result.rowLength}`);
                if (result.nextPage) {
                    result.nextPage();
                } else {
                    resolve();
                }
            },
        );
    });
}

example().catch(function (err) {
    console.error("There was an error", err.message, err.stack);
});
