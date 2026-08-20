"use strict";
const cassandra = require("@scylladb/driver");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

/**
 * Creates a table, a materialized view over it, and retrieves the view's metadata.
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples_mv WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute(
        "CREATE TABLE IF NOT EXISTS examples_mv.metadata_mv_base " +
            "(id uuid PRIMARY KEY, category text, name text)",
    );

    await client.execute(
        "CREATE MATERIALIZED VIEW IF NOT EXISTS examples_mv.metadata_mv_by_category AS " +
            "SELECT * FROM examples_mv.metadata_mv_base " +
            "WHERE category IS NOT NULL AND id IS NOT NULL " +
            "PRIMARY KEY (category, id)",
    );

    const view = client.metadata.getMaterializedView(
        "examples_mv",
        "metadata_mv_by_category",
    );

    console.log("View on base table:", view.tableName);
    console.log("Partition key:", view.partitionKey);
    console.log("Clustering key:", view.clusteringKey);
    console.log("Columns:", Object.keys(view.columns));
}

example().catch(function (err) {
    console.error("There was an error", err);
    process.exitCode = 1;
});
