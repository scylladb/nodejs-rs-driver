"use strict";

const assert = require("assert");

const helper = require("../../test-helper.js");
const Client = require("../../../lib/client.js");
const types = require("../../../lib/types");
const rust = require("../../../index");

const COMPRESSION = "COMPRESSION";
const CLIENT_ID = "CLIENT_ID";
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 20000;

describe("Client compression", function () {
    this.timeout(60000);

    // The clients table is node-local. A single-node cluster lets one query see
    // every connection opened by the client under test.
    helper.setup(1, { initClient: false });

    // Both ScyllaDB (system.clients, since 2026.1) and Cassandra
    // (system_views.clients, since 4.1) record the STARTUP options of each
    // connection in client_options, under different table names.
    const isScylla = helper.getServerInfo().isScylla;
    const clientsTable = isScylla ? "system.clients" : "system_views.clients";

    before(async function () {
        const client = new Client(helper.baseOptions);
        let available = true;
        try {
            await client.connect();
            try {
                await client.execute(
                    `SELECT client_options FROM ${clientsTable} LIMIT 1`,
                );
            } catch (err) {
                if (!isMissingSchemaError(err)) {
                    throw err;
                }
                // Only older servers lack the table or column. The negotiated
                // compression cannot be observed there, so there is nothing to test.
                helper.trace(
                    `${clientsTable}.client_options unavailable: ${err}`,
                );
                available = false;
            }
        } finally {
            await client.shutdown();
        }
        if (!available) {
            this.skip();
        }
    });

    for (const compression of ["lz4", "snappy"]) {
        it(`should negotiate ${compression} compression on every connection`, async function () {
            await assertNegotiatedCompression(compression);
        });
    }

    it("should not negotiate compression by default", async function () {
        await assertNegotiatedCompression(undefined);
    });

    /**
     * Tells whether the probe of the clients table failed because the server
     * lacks that keyspace, table or column.
     *
     * The driver rejects with a plain `Error` named `ExecutionError` for every
     * server error, so the server's `Invalid` (0x2200) error is recognized by
     * its message, and the server's text must name what was probed. Any other
     * error, such as a timeout or a lost connection, is not a missing schema.
     * @param {Error} err The error the probe query was rejected with.
     * @returns {boolean}
     */
    function isMissingSchemaError(err) {
        const invalid =
            "Database returned an error: The query is syntactically correct but invalid, Error message: ";
        return (
            err instanceof Error &&
            err.name === "ExecutionError" &&
            err.message.startsWith(invalid) &&
            /client_options|clients|system_views/i.test(
                err.message.slice(invalid.length),
            )
        );
    }

    /**
     * Connects a client with the given compression, checks that it can run
     * queries, and checks the COMPRESSION startup option that the server
     * recorded for each of its connections.
     * @param {string|undefined} compression The `protocolOptions.compression`
     * to set, or `undefined` to leave it unset.
     */
    async function assertNegotiatedCompression(compression) {
        const clientId = types.Uuid.random().toString();
        const options = { ...helper.baseOptions, id: clientId };
        if (compression !== undefined) {
            options.protocolOptions = { compression };
        }
        const client = new Client(options);
        try {
            await client.connect();
            // Queries go over the pool connections, which carry compressed frames.
            const rs = await client.execute("SELECT key FROM system.local");
            assert.strictEqual(rs.rows.length, 1);

            const connections = await waitForAllConnections(client, clientId);
            for (const clientOptions of connections) {
                assert.strictEqual(clientOptions[COMPRESSION], compression);
            }
        } finally {
            await client.shutdown();
        }
    }

    /**
     * Polls the clients table until every connection of the client is visible,
     * and returns the client_options of each.
     *
     * Session creation waits only for the first pool connection to each node.
     * The remaining per-shard connections open asynchronously, so this waits
     * for the control-plus-pool count known by the Rust session and, on
     * ScyllaDB, for every shard to be represented. Closed connections can
     * linger in the table, so the count is a lower bound.
     * @param {Client} client The connected client.
     * @param {string} clientId The id the client was created with.
     * @returns {Promise<Array<Object<string, string>>>}
     */
    async function waitForAllConnections(client, clientId) {
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        const expectedCount = rust.testsExpectedConnectionCount(
            client.rustClient.inner,
        );
        const columns = isScylla
            ? "shard_id, client_options"
            : "client_options";
        let matching = [];
        let shardCount = 0;

        while (Date.now() < deadline) {
            const result = await client.execute(
                `SELECT ${columns} FROM ${clientsTable}`,
            );
            matching = result.rows.filter(
                (row) =>
                    row.client_options &&
                    row.client_options[CLIENT_ID] === clientId,
            );
            shardCount = new Set(matching.map((row) => row.shard_id)).size;
            if (
                matching.length >= expectedCount &&
                (!isScylla || shardCount === expectedCount - 1)
            ) {
                return matching.map((row) => row.client_options);
            }
            await helper.delayAsync(POLL_INTERVAL_MS);
        }
        assert.fail(
            `client ${clientId} did not settle in ${clientsTable} within ${POLL_TIMEOUT_MS}ms; ` +
                `expected at least ${expectedCount} connections, last observed ${matching.length}` +
                (isScylla ? ` across ${shardCount} shards` : ""),
        );
    }
});
