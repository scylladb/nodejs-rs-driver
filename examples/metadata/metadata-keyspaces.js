"use strict";
const cassandra = require("@scylladb/driver");
const { getClientArgs } = require("../util");

const { StrategyKind } = cassandra.metadata;

const client = new cassandra.Client(getClientArgs());

/**
 * Creates a keyspace and lists metadata for every keyspace in the cluster.
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples_keyspace WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    console.log("Keyspaces in the cluster:");
    for (const [name, keyspace] of client.metadata.getKeyspaces()) {
        console.log(
            "- %s: %s, durableWrites=%s, %d table(s), %d view(s), %d udt(s)",
            name,
            StrategyKind[keyspace.strategy.kind],
            keyspace.durableWrites,
            Object.keys(keyspace.tables).length,
            Object.keys(keyspace.views).length,
            Object.keys(keyspace.udts).length,
        );
    }

    const examplesKs = client.metadata.getKeyspace("examples_keyspace");
    console.log(
        "\n'examples_keyspace' keyspace strategy: Strategy { kind: %s, datacenterRepfactors: %s }",
        StrategyKind[examplesKs.strategy.kind],
        examplesKs.strategy.datacenterRepfactors,
    );
}

example().catch(function (err) {
    console.error("There was an error", err);
    process.exitCode = 1;
});
