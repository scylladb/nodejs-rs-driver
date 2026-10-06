"use strict";

const assert = require("assert");
const net = require("node:net");

const helper = require("../../test-helper.js");
const Client = require("../../../lib/client.js");
const policies = require("../../../lib/policies/index.js");
const rust = require("../../../index");

const REQUEST_TIMEOUT_MS = 25;
const SESSION_DEFAULT_REQUEST_TIMEOUT_MS = 50;
const EXECUTION_DELAY_MS = 200;
const PAGE_DELAY_MS = 100;
const PAGE_TIMEOUT_MS = 250;

describe("Client request timeout", function () {
    this.timeout(60000);

    const keyspace = helper.getRandomName("ks");
    const table = `${keyspace}.${helper.getRandomName("table")}`;
    let client;
    let proxyStarted = false;

    // Register this before helper.setup() so the proxy is stopped before CCM
    // removes the backend node, including when setup or a test fails.
    after(cleanup);
    helper.setup(1, { initClient: false });

    before(async function () {
        let discoveryClient;
        try {
            discoveryClient = new Client(helper.baseOptions);
            await discoveryClient.connect();
            const realAddress = discoveryClient.hosts
                .values()[0]
                .addressToString();
            await discoveryClient.shutdown();
            discoveryClient = undefined;

            const proxyAddress =
                await rust.testsStartRequestTimeoutProxy(realAddress);
            proxyStarted = true;
            const realSocketAddress = toSocketAddress(realAddress);
            const proxySocketAddress = toSocketAddress(proxyAddress);
            const addressMapping = new Map([
                [realSocketAddress, proxySocketAddress],
                [
                    new net.SocketAddress({
                        address: realSocketAddress.address,
                        port: 19042,
                    }),
                    proxySocketAddress,
                ],
            ]);

            client = new Client({
                ...helper.baseOptions,
                contactPoints: [proxyAddress],
                policies: {
                    ...helper.baseOptions.policies,
                    addressResolution:
                        new policies.addressResolution.MappingAddressTranslator(
                            addressMapping,
                        ),
                },
            });
            await client.connect();
            await helper.ddl(
                client,
                `CREATE KEYSPACE ${keyspace} WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}`,
            );
            await helper.ddl(
                client,
                `CREATE TABLE ${table} (id int PRIMARY KEY)`,
            );
            await client.batch([
                `INSERT INTO ${table} (id) VALUES (1)`,
                `INSERT INTO ${table} (id) VALUES (2)`,
                `INSERT INTO ${table} (id) VALUES (3)`,
            ]);

            rust.testsSetSessionDefaultRequestTimeout(
                client.rustClient,
                SESSION_DEFAULT_REQUEST_TIMEOUT_MS,
            );
            await rust.testsSetRequestTimeoutProxyDelay(EXECUTION_DELAY_MS);
        } catch (err) {
            try {
                if (discoveryClient) {
                    await discoveryClient.shutdown();
                }
            } finally {
                await cleanup();
            }
            throw err;
        }
    });

    it("enforces requestTimeout for an unprepared execution", async function () {
        await assertTimesOut(() =>
            client.execute("SELECT key FROM system.local", [], {
                requestTimeout: REQUEST_TIMEOUT_MS,
            }),
        );
    });

    it("uses the Rust default when requestTimeout is omitted", async function () {
        await assertTimesOut(
            () => client.execute("SELECT key FROM system.local"),
            SESSION_DEFAULT_REQUEST_TIMEOUT_MS,
        );
    });

    it("enforces requestTimeout for a prepared execution", async function () {
        await assertTimesOut(() =>
            client.execute("SELECT key FROM system.local", [], {
                prepare: true,
                requestTimeout: REQUEST_TIMEOUT_MS,
            }),
        );
    });

    it("enforces requestTimeout for a batch execution", async function () {
        await assertTimesOut(() =>
            client.batch([`INSERT INTO ${table} (id) VALUES (1)`], {
                requestTimeout: REQUEST_TIMEOUT_MS,
            }),
        );
    });

    it("disables the timeout when requestTimeout is zero", async function () {
        const result = await client.execute(
            "SELECT key FROM system.local",
            [],
            {
                requestTimeout: 0,
            },
        );
        assert.strictEqual(result.rows.length, 1);
    });

    it("starts a fresh timeout for every result page", async function () {
        await rust.testsSetRequestTimeoutProxyDelay(PAGE_DELAY_MS);
        const startedAt = Date.now();
        try {
            const result = await client.execute(
                `SELECT id FROM ${table} WHERE id IN (1, 2, 3)`,
                [],
                {
                    fetchSize: 1,
                    prepare: true,
                    requestTimeout: PAGE_TIMEOUT_MS,
                },
            );
            const ids = [];
            for await (const row of result) {
                ids.push(row.id);
            }

            assert.deepStrictEqual(ids.sort(), [1, 2, 3]);
            assert.ok(
                Date.now() - startedAt >= PAGE_TIMEOUT_MS,
                "all pages should take longer than one page's timeout budget",
            );
        } finally {
            await rust.testsSetRequestTimeoutProxyDelay(EXECUTION_DELAY_MS);
        }
    });

    async function cleanup() {
        try {
            if (client) {
                await client.shutdown();
                client = undefined;
            }
        } finally {
            if (proxyStarted) {
                try {
                    await rust.testsClearRequestTimeoutProxyDelay();
                } finally {
                    await rust.testsStopRequestTimeoutProxy();
                    proxyStarted = false;
                }
            }
        }
    }
});

async function assertTimesOut(execute, timeoutMs = REQUEST_TIMEOUT_MS) {
    await assert.rejects(execute, (err) => {
        helper.assertErrorWithName(err, "ExecutionError");
        assert.strictEqual(
            err.message,
            `Request execution exceeded a client timeout of ${timeoutMs}ms`,
        );
        return true;
    });
}

function splitHostPort(address) {
    const separatorIndex = address.lastIndexOf(":");
    return [
        address.slice(0, separatorIndex),
        address.slice(separatorIndex + 1),
    ];
}

function toSocketAddress(value) {
    const [host, port] = splitHostPort(value);
    const address = host.startsWith("[") ? host.slice(1, -1) : host;
    return new net.SocketAddress({ address, port: Number(port) });
}
