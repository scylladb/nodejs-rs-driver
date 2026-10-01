"use strict";

const assert = require("assert");

const helper = require("../../test-helper.js");
const Client = require("../../../lib/client.js");
const types = require("../../../lib/types");
const rust = require("../../../index");

const DRIVER_CONFIG = "DRIVER_CONFIG";
const SESSION_ID = "SESSION_ID";
const CLIENT_ID = "CLIENT_ID";
const CLIENTS_TABLE = "system.clients";
const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 20000;

describe("Driver configuration reporting", function () {
    this.timeout(60000);

    // system.clients is node-local. A single-node cluster lets one query see
    // every connection opened by the client under test.
    helper.setup(1, { initClient: false });

    before(async function () {
        if (!helper.getServerInfo().isScylla) {
            this.skip();
        }

        const client = new Client(helper.baseOptions);
        try {
            await client.connect();
            const clientsTable = client.metadata.getTable("system", "clients");
            if (!clientsTable || !clientsTable.columns.client_options) {
                this.skip();
            }
        } finally {
            await client.shutdown();
        }
    });

    it("reports DRIVER_CONFIG once, on the control connection", async function () {
        const clientId = types.Uuid.random();
        const client = createClient(clientId);

        try {
            await client.connect();
            const options = await waitForClientOptions(
                client,
                clientId.toString(),
                1,
            );

            assertSingleSessionId(options);
            const reports = options
                .filter((row) => DRIVER_CONFIG in row)
                .map((row) => row[DRIVER_CONFIG]);
            assert.strictEqual(
                reports.length,
                1,
                "exactly the control connection should report DRIVER_CONFIG",
            );

            const report = JSON.parse(reports[0]);
            assert.strictEqual(report.version, 1);
            assert.ok(report.connection);
            assert.ok(report["control-plane"]);
            assert.ok(report.query);
        } finally {
            await client.shutdown();
        }
    });

    it("keeps SESSION_ID when DRIVER_CONFIG reporting is disabled", async function () {
        const clientId = types.Uuid.random();
        const client = createClient(clientId, false);

        try {
            await client.connect();
            const options = await waitForClientOptions(
                client,
                clientId.toString(),
            );

            assertSingleSessionId(options);
            assert.ok(
                options.every((row) => !(DRIVER_CONFIG in row)),
                "DRIVER_CONFIG should be absent from every connection",
            );
        } finally {
            await client.shutdown();
        }
    });
});

function createClient(clientId, driverConfigReportingEnabled) {
    const options = {
        ...helper.baseOptions,
        id: clientId,
    };
    if (driverConfigReportingEnabled !== undefined) {
        options.driverConfigReportingEnabled = driverConfigReportingEnabled;
    }
    return new Client(options);
}

async function waitForClientOptions(
    client,
    clientId,
    expectedDriverConfigCount,
) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const expectedCount = rust.testsExpectedConnectionCount(client.rustClient);
    let matching = [];
    let observedShardCount = 0;
    let observedDriverConfigCount = 0;

    while (Date.now() < deadline) {
        const result = await client.execute(
            `SELECT shard_id, client_options FROM ${CLIENTS_TABLE}`,
        );
        matching = result.rows.filter(
            (row) =>
                row.client_options &&
                row.client_options[CLIENT_ID] === clientId,
        );
        observedShardCount = new Set(matching.map((row) => row.shard_id)).size;
        observedDriverConfigCount = matching.filter(
            (row) => DRIVER_CONFIG in row.client_options,
        ).length;

        // Session creation waits only for the first pool connection to each
        // node. The remaining per-shard connections open asynchronously, so
        // wait for at least the control-plus-pool count known by the Rust
        // session and for every shard to be represented. Closed connections
        // can linger in system.clients, so the count is a lower bound.
        if (
            matching.length >= expectedCount &&
            observedShardCount === expectedCount - 1 &&
            (expectedDriverConfigCount === undefined ||
                observedDriverConfigCount === expectedDriverConfigCount)
        ) {
            return matching.map((row) => row.client_options);
        }
        await helper.delayAsync(POLL_INTERVAL_MS);
    }

    const expectedDriverConfigDetails =
        expectedDriverConfigCount === undefined
            ? ""
            : ` and exactly ${expectedDriverConfigCount} DRIVER_CONFIG reports`;
    assert.fail(
        `client ${clientId} did not settle in ${CLIENTS_TABLE} within ${POLL_TIMEOUT_MS}ms; ` +
            `expected at least ${expectedCount} connections across ${expectedCount - 1} shards` +
            `${expectedDriverConfigDetails}, last observed ${matching.length} connections across ` +
            `${observedShardCount} shards and ${observedDriverConfigCount} DRIVER_CONFIG reports`,
    );
}

function assertSingleSessionId(options) {
    assert.ok(options.length > 0, "expected at least one client connection");
    assert.ok(
        options.every((row) => typeof row[SESSION_ID] === "string"),
        "every connection should report SESSION_ID",
    );
    assert.strictEqual(
        new Set(options.map((row) => row[SESSION_ID])).size,
        1,
        "every connection should report the same SESSION_ID",
    );
}
