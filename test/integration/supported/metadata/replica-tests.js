"use strict";
const assert = require("chai").assert;

const helper = require("../../../test-helper");
const rust = require("../../../../index");

describe("Metadata replicas", function () {
    this.timeout(300000);

    const nodeCount = 3;
    const setupInfo = helper.setup(`${nodeCount}:0`);
    const replicationFactors = [1, 2, 3];
    const table = "replicated";
    const partitionKey = "partition";
    const otherPartitionKey = "another-partition";

    // One keyspace per replication factor, all of them divided into vnodes, where a placement
    // follows from the cluster's topology and the replication strategy alone - so every lookup
    // below is answered without a single request having to be routed first.
    const vnodeKeyspaces = new Map();
    // A keyspace divided into tablets, left null where the server has no tablets to divide it by.
    let tabletKeyspace = null;

    before(async function () {
        const client = setupInfo.client;

        for (const replicationFactor of replicationFactors) {
            const keyspace = helper.getRandomName("ks");
            await helper.ddl(
                client,
                helper.keyspaceDefinitionWithTabletsDisabled(
                    client,
                    helper.createKeyspaceCql(keyspace, replicationFactor),
                ),
            );
            await createTable(keyspace, table);
            vnodeKeyspaces.set(replicationFactor, keyspace);
        }

        if (
            helper.getServerInfo().isScylla &&
            (await rust.scyllaSupportsTablets(client.rustClient))
        ) {
            tabletKeyspace = helper.getRandomName("ks");
            await helper.ddl(
                client,
                `${helper.createKeyspaceCql(tabletKeyspace, 2)} AND tablets = {'initial': 8}`,
            );
            await createTable(tabletKeyspace, table);
            await learnPlacementOf(partitionKey);
            await learnPlacementOf(otherPartitionKey);
        }
    });

    /**
     * Creates a table and waits until the driver has read it back.
     *
     * A DDL statement is answered as soon as the server has applied it, while the driver learns
     * of the new schema on its own, so the table is not part of the metadata the instant the
     * statement returns.
     */
    async function createTable(keyspace, name) {
        await helper.ddl(
            setupInfo.client,
            `CREATE TABLE ${keyspace}.${name} (k text PRIMARY KEY)`,
        );
    }

    /**
     * Writes the given partition of the tablets keyspace until the driver knows where it lives.
     *
     * The server owns the division into tablets and reports the tablet a request belongs to only
     * when it had to route the request itself, so a request that happens to land on the right
     * shard of the right node teaches the driver nothing, and repeating it is what eventually
     * gets the tablet reported.
     */
    async function learnPlacementOf(key) {
        await helper.wait.until(async () => {
            await setupInfo.client.execute(
                `INSERT INTO ${tabletKeyspace}.${table} (k) VALUES (?)`,
                [key],
                { prepare: true },
            );
            return replicasOf(tabletKeyspace, key).length > 0;
        });
    }

    /** The replicas of the given partition key of the given keyspace. */
    function replicasOf(keyspace, key) {
        let token = setupInfo.client.metadata.newToken(
            Buffer.from(key, "utf8"),
            keyspace,
            table,
        );
        return setupInfo.client.metadata.getReplicas(keyspace, table, token);
    }

    /**
     * The given replicas rendered as sorted `host id/shard` strings, so that two replica sets can
     * be compared whole - a replica being a shard of a node, not the node alone.
     */
    function sortedPlacements(replicas) {
        return replicas
            .map((replica) => `${replica.host.hostId}/${replica.shard}`)
            .sort();
    }

    describe("#getReplicas()", function () {
        describe("the replicas it returns", function () {
            it("should be as many as the keyspace's replication factor", function () {
                for (const [
                    replicationFactor,
                    keyspace,
                ] of vnodeKeyspaces.entries()) {
                    assert.lengthOf(
                        replicasOf(keyspace, partitionKey),
                        replicationFactor,
                        `keyspace ${keyspace} replicates every partition ${replicationFactor} times`,
                    );
                }
            });

            it("should be the whole cluster when every node replicates everything", function () {
                const replicas = replicasOf(
                    vnodeKeyspaces.get(nodeCount),
                    partitionKey,
                );

                assert.deepEqual(
                    replicas
                        .map((replica) => replica.host.hostId.toString())
                        .sort(),
                    setupInfo.client.hosts
                        .keys()
                        .map((hostId) => hostId.toString())
                        .sort(),
                );
            });

            it("should each be a node of the cluster, as the very object Client#hosts holds", function () {
                for (const keyspace of vnodeKeyspaces.values()) {
                    for (const replica of replicasOf(keyspace, partitionKey)) {
                        assert.strictEqual(
                            setupInfo.client.hosts.get(replica.host.hostId),
                            replica.host,
                            "a replica's host is not the host object the cluster is made of",
                        );
                    }
                }
            });

            it("should each name a shard of that node", function () {
                for (const keyspace of vnodeKeyspaces.values()) {
                    for (const replica of replicasOf(keyspace, partitionKey)) {
                        assert.isTrue(
                            Number.isSafeInteger(replica.shard) &&
                                replica.shard >= 0,
                            `shard ${replica.shard} is not the index of a shard`,
                        );
                    }
                }
            });

            it("should never report the same node twice", function () {
                for (const [
                    replicationFactor,
                    keyspace,
                ] of vnodeKeyspaces.entries()) {
                    const replicas = replicasOf(keyspace, partitionKey);
                    const hostIds = new Set(
                        replicas.map((replica) =>
                            replica.host.hostId.toString(),
                        ),
                    );

                    assert.lengthOf(
                        hostIds,
                        replicationFactor,
                        "a node was reported as a replica more than once",
                    );
                }
            });
        });

        describe("the placements it describes", function () {
            it("should be the same across repeated calls", function () {
                for (const keyspace of vnodeKeyspaces.values()) {
                    const first = replicasOf(keyspace, partitionKey);
                    const second = replicasOf(keyspace, partitionKey);

                    assert.deepEqual(
                        sortedPlacements(second),
                        sortedPlacements(first),
                        "the same partition was placed differently across calls",
                    );
                }
            });

            it("should be the same for a partition key, its token and a range holding it", function () {
                const metadata = setupInfo.client.metadata;
                for (const keyspace of vnodeKeyspaces.values()) {
                    const token = metadata.newToken(
                        Buffer.from(partitionKey, "utf8"),
                        keyspace,
                        table,
                    );
                    const range = metadata.newTokenRange(
                        metadata.newToken(
                            Buffer.from(otherPartitionKey, "utf8"),
                            keyspace,
                            table,
                        ),
                        token,
                    );

                    const fromKey = sortedPlacements(
                        replicasOf(keyspace, partitionKey),
                    );
                    assert.deepEqual(
                        sortedPlacements(
                            metadata.getReplicas(keyspace, table, token),
                        ),
                        fromKey,
                    );
                    assert.deepEqual(
                        sortedPlacements(
                            metadata.getReplicas(keyspace, table, range),
                        ),
                        fromKey,
                    );
                }
            });
        });

        describe("when the keyspace is divided into tablets", function () {
            beforeEach(function () {
                if (tabletKeyspace === null) {
                    this.skip();
                }
            });

            it("should place a partition on the replicas the server assigned its tablet", async function () {
                // One row per tablet, holding the token the tablet ends at and the replicas it lives on.
                const result = await setupInfo.client.execute(
                    "SELECT keyspace_name, table_name, last_token, replicas" +
                        " FROM system.tablets",
                );
                const rows = result.rows.filter(
                    (row) =>
                        row["keyspace_name"] === tabletKeyspace &&
                        row["table_name"] === table,
                );
                assert.isNotEmpty(
                    rows,
                    "the server reports no tablets for a keyspace it was asked to divide into them",
                );

                const token = setupInfo.client.metadata
                    .newToken(
                        Buffer.from(partitionKey, "utf8"),
                        tabletKeyspace,
                        table,
                    )
                    .getValue();

                const tablet = rows
                    .map((row) => ({
                        end: BigInt(row["last_token"].toString()),
                        replicas: row["replicas"],
                    }))
                    .sort((a, b) => (a.end < b.end ? -1 : 1))
                    .find((tablet) => token <= tablet.end);

                // A replica of a tablet is a `(host id, shard)` pair, since a tablet is assigned
                // to one specific shard of each of its nodes – the same pair the driver reports.
                const expected = tablet.replicas
                    .map((replica) => `${replica.get(0)}/${replica.get(1)}`)
                    .sort();
                assert.deepEqual(
                    sortedPlacements(replicasOf(tabletKeyspace, partitionKey)),
                    expected,
                );
            });

            it("should return as many replicas as the keyspace's replication factor", function () {
                assert.lengthOf(replicasOf(tabletKeyspace, partitionKey), 2);
            });
        });

        describe("when passed incorrect parameters", function () {
            it("should fallback to simple strategy for incorrect keyspace", async function () {
                const metadata = setupInfo.client.metadata;
                const token = metadata.newToken(
                    Buffer.from(partitionKey, "utf8"),
                    vnodeKeyspaces.get(nodeCount),
                    table,
                );
                let replicas = metadata.getReplicas(
                    "non-existent-keyspace",
                    table,
                    token,
                );
                assert.lengthOf(replicas, 1);
            });
        });
    });
});
