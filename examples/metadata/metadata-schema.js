"use strict";
const cassandra = require("@scylladb/driver");
const { getClientArgs } = require("../util");

// Both are numeric enums, so they double as reverse lookups for logging.
const { StrategyKind, ColumnKind } = cassandra.metadata;

const client = new cassandra.Client(getClientArgs());

const keyspace = "examples_schema";

/**
 * Creates a keyspace with a table, a user-defined type and a materialized view, then reads all of
 * its schema metadata back.
 */
async function example() {
    await client.connect();

    await client.execute(
        `CREATE KEYSPACE IF NOT EXISTS ${keyspace} WITH replication =` +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute(
        `CREATE TYPE IF NOT EXISTS ${keyspace}.address ` +
            "(street text, city text, zip int)",
    );

    await client.execute(
        `CREATE TABLE IF NOT EXISTS ${keyspace}.users ` +
            "(id uuid, created_at timeuuid, category text, home frozen<address>, " +
            "PRIMARY KEY (id, created_at))",
    );

    await client.execute(
        `CREATE MATERIALIZED VIEW IF NOT EXISTS ${keyspace}.users_by_category AS ` +
            `SELECT * FROM ${keyspace}.users ` +
            "WHERE category IS NOT NULL AND id IS NOT NULL AND created_at IS NOT NULL " +
            "PRIMARY KEY (category, id, created_at)",
    );

    // --- Keyspaces -------------------------------------------------------------------------
    const ks = client.metadata.getKeyspace(keyspace);
    console.log("Keyspace %s:", keyspace);
    console.log("  strategy: %s", StrategyKind[ks.strategy.kind]);
    console.log("  datacenter replication:", ks.strategy.datacenterRepfactors);
    console.log("  durableWrites: %s", ks.durableWrites);

    console.log(
        "  contains %d table(s), %d view(s), %d udt(s)",
        Object.keys(ks.tables).length,
        Object.keys(ks.views).length,
        Object.keys(ks.udts).length,
    );

    console.log(
        "All keyspaces in the cluster: %d",
        client.metadata.getKeyspaces().size,
    );

    // --- Tables ----------------------------------------------------------------------------
    const table = client.metadata.getTable(keyspace, "users");
    console.log("\nTable users:");
    console.log("  partition key:", table.partitionKey);
    console.log("  clustering key:", table.clusteringKey);
    console.log("  columns:");
    for (const [name, column] of Object.entries(table.columns)) {
        // column.type is a ColumnInfo; its `code` is a numeric CqlType.
        console.log(
            "    - %s: type code %d, kind %s",
            name,
            column.type.code,
            ColumnKind[column.kind],
        );
    }

    // --- User-defined types ----------------------------------------------------------------
    const udt = client.metadata.getUdt(keyspace, "address");
    console.log("\nUDT %s (keyspace %s):", udt.name, udt.keyspace);
    for (const field of udt.fields) {
        console.log("  - %s: type code %d", field.name, field.type.code);
    }

    // --- Materialized views ----------------------------------------------------------------
    const view = client.metadata.getMaterializedView(
        keyspace,
        "users_by_category",
    );
    console.log("\nView users_by_category:");
    console.log("  base table: %s", view.tableName);
    console.log("  partition key:", view.partitionKey);
    console.log("  clustering key:", view.clusteringKey);
    console.log("  columns:", Object.keys(view.columns));
}

example().catch(function (err) {
    console.error("There was an error", err);
    process.exitCode = 1;
});
