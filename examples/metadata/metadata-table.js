"use strict";
const cassandra = require("@scylladb/driver");
const { getClientArgs } = require("../util");

const { ColumnKind } = cassandra.metadata;

const client = new cassandra.Client(getClientArgs());

/**
 * Creates a table and retrieves its metadata.
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples_table WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute(
        "CREATE TABLE IF NOT EXISTS examples_table.metadata_table_example " +
            "(id uuid, created_at timeuuid, description text, PRIMARY KEY (id, created_at))",
    );

    const table = client.metadata.getTable(
        "examples_table",
        "metadata_table_example",
    );

    console.log("Partition key:", table.partitionKey);
    console.log("Clustering key:", table.clusteringKey);
    console.log("Partitioner:", table.partitioner);

    console.log("Columns:");
    for (const [name, column] of Object.entries(table.columns)) {
        console.log(
            "- %s: type code %d, kind %s",
            name,
            column.type.code,
            ColumnKind[column.kind],
        );
    }
}

example().catch(function (err) {
    console.error("There was an error", err);
    process.exitCode = 1;
});
