"use strict";

// These shared prepared-statement tests require a native addon built with the
// `tests` Cargo feature (`npm run build:test`).

const assert = require("assert");
const net = require("node:net");
const helper = require("../../test-helper");
const Client = require("../../../lib/client");
const policies = require("../../../lib/policies");
const rust = require("../../../index");

module.exports = function addBindMarkerTests(setup, keyspace) {
    describe("prepared IN bind markers", function () {
        this.timeout(60000);
        const table = `${keyspace}.bind_markers`;
        const clients = [];

        // Reuse the parent prepared-statement fixture and stop its test-only
        // proxy connections even when a connection attempt or assertion fails.
        afterEach(async function () {
            try {
                await rust.testsStopBindMarkerProxies();
            } finally {
                await Promise.all(
                    clients.splice(0).map((client) => client.shutdown()),
                );
            }
        });

        before(async function () {
            await helper.ddl(
                setup.client,
                `CREATE TABLE ${table} (pk int, ck int, value int, PRIMARY KEY (pk, ck))`,
            );
            for (const ck of [1, 2]) {
                await setup.client.execute(
                    `INSERT INTO ${table} (pk, ck, value) VALUES (1, ${ck}, ${ck * 10})`,
                );
            }
        });

        function endpoint({ address, port }) {
            return net.isIPv6(address)
                ? `[${address}]:${port}`
                : `${address}:${port}`;
        }

        function socketAddress(address, port) {
            return new net.SocketAddress({
                address,
                port,
                family: net.isIPv6(address) ? "ipv6" : "ipv4",
            });
        }

        async function createClient(names, options = {}) {
            const backends = setup.client.hosts
                .values()
                .slice(0, names.length)
                .map((host) => host.address);
            assert.strictEqual(
                backends.length,
                names.length,
                "fixture needs distinct nodes",
            );
            const addresses = await rust.testsStartBindMarkerProxies(
                backends.map(endpoint),
            );
            const mapping = new Map();
            const allowList = [];
            for (const [index, backend] of backends.entries()) {
                const separator = addresses[index].lastIndexOf(":");
                const address = addresses[index]
                    .slice(0, separator)
                    .replace(/^\[|\]$/g, "");
                const translated = socketAddress(
                    address,
                    Number(addresses[index].slice(separator + 1)),
                );
                for (const port of new Set([
                    9042,
                    19042,
                    backend.port,
                    translated.port,
                ])) {
                    mapping.set(
                        socketAddress(backend.address, port),
                        translated,
                    );
                    allowList.push(
                        endpoint({ address: backend.address, port }),
                    );
                }
                mapping.set(translated, translated);
                allowList.push(addresses[index]);
                await rust.testsConfigureBindMarkerProxy(
                    index,
                    names[index],
                    false,
                );
            }
            const client = new Client({
                ...helper.baseOptions,
                contactPoints: addresses,
                ...options,
                policies: {
                    ...helper.baseOptions.policies,
                    loadBalancing: new policies.loadBalancing.AllowListPolicy(
                        new policies.loadBalancing.RoundRobinPolicy(),
                        allowList,
                    ),
                    addressResolution:
                        new policies.addressResolution.MappingAddressTranslator(
                            mapping,
                        ),
                },
            });
            clients.push(client);
            await client.connect();
            return client;
        }

        function assertRows(result) {
            assert.deepStrictEqual(
                result.rows.map((row) => row.ck),
                [1, 2],
            );
        }

        for (const name of ["IN(ck)", "in(ck)"]) {
            it(`binds arrays and explicit names with ${name} prepared metadata`, async function () {
                const client = await createClient([name]);
                for (const paged of [false, true]) {
                    for (const [restriction, params] of [
                        ["ck IN ?", [1, [2, 1]]],
                        ["ck IN (?, ?)", [1, 2, 1]],
                        ["ck IN :items", { key: 1, items: [2, 1] }],
                        [
                            "ck IN (:first, :second)",
                            { second: 1, key: 1, first: 2 },
                        ],
                    ]) {
                        const key = Array.isArray(params) ? "?" : ":key";
                        assertRows(
                            await client.execute(
                                `SELECT ck FROM ${table} WHERE pk = ${key} AND ${restriction}`,
                                params,
                                { prepare: true, paged },
                            ),
                        );
                    }
                }
                const [stats] = await rust.testsBindMarkerProxyStats();
                assert.ok(
                    stats.names.includes(name),
                    "proxy must rewrite actual PREPARED metadata",
                );
            });

            it(`recovers from UNPREPARED after ${name} changes beyond case`, async function () {
                const client = await createClient([name], { maxPrepared: 1 });
                const query = `SELECT ck FROM ${table} WHERE pk = ? AND ck IN ?`;
                const prepared = await client.prepareStatement(query);
                assert.deepStrictEqual(prepared.boundParamNames, [
                    "pk",
                    "in(ck)",
                ]);
                const [before] = await rust.testsBindMarkerProxyStats();
                await rust.testsConfigureBindMarkerProxy(
                    0,
                    "items_after_upgrade",
                    true,
                );
                assertRows(
                    await client.execute(query, [1, [2, 1]], { prepare: true }),
                );
                const [after] = await rust.testsBindMarkerProxyStats();
                assert.strictEqual(after.unprepared - before.unprepared, 1);
                assert.ok(
                    after.prepares > before.prepares,
                    "UNPREPARED must cause a new PREPARE",
                );
                assert.ok(after.names.includes(name));
                assert.ok(after.names.includes("items_after_upgrade"));
                assert.strictEqual(
                    await client.prepareStatement(query),
                    prepared,
                );
                // A cached handle still looks up the original name even after
                // reprepare supplies different metadata.
                assertRows(
                    await client.execute(
                        query,
                        { pk: 1, "in(ck)": [1, 2] },
                        { prepare: true },
                    ),
                );

                await client.execute("SELECT key FROM system.local", [], {
                    prepare: true,
                });
                const refreshed = await client.prepareStatement(query);
                assert.notStrictEqual(refreshed.handle, prepared.handle);
                assert.deepStrictEqual(refreshed.boundParamNames, [
                    "pk",
                    "items_after_upgrade",
                ]);
                await assert.rejects(
                    client.execute(
                        query,
                        { pk: 1, "in(ck)": [1, 2] },
                        { prepare: true },
                    ),
                    /items_after_upgrade/,
                );
                assertRows(
                    await client.execute(query, [1, [1, 2]], { prepare: true }),
                );
                assertRows(
                    await client.execute(
                        query,
                        { pk: 1, ["items_after_upgrade"]: [1, 2] },
                        { prepare: true },
                    ),
                );
            });
        }

        it("uses one client concurrently across nodes reporting different names", async function () {
            const names = ["in(ck)", "items_after_upgrade"];
            const client = await createClient(names);
            const queries = [
                [
                    `SELECT ck FROM ${table} WHERE pk = ? AND ck IN ?`,
                    [1, [2, 1]],
                ],
                [
                    `SELECT ck FROM ${table} WHERE pk = :key AND ck IN :items`,
                    { items: [2, 1], key: 1 },
                ],
            ];
            const before = await rust.testsBindMarkerProxyStats();
            await Promise.all(
                Array.from({ length: 16 }, async (_, index) => {
                    const [query, params] = queries[index % queries.length];
                    const result = await client.execute(query, params, {
                        prepare: true,
                        fetchSize: 1,
                    });
                    const rows = [];
                    for await (const row of result) rows.push(row.ck);
                    assert.deepStrictEqual(rows, [1, 2]);
                }),
            );
            const after = await rust.testsBindMarkerProxyStats();
            for (const [index, name] of names.entries()) {
                assert.ok(
                    after[index].prepares > before[index].prepares,
                    "both nodes must prepare the tested queries",
                );
                assert.ok(
                    after[index].executes > before[index].executes,
                    "both nodes must execute concurrent requests",
                );
                assert.ok(
                    after[index].names.includes(name),
                    "both nodes must return their own PREPARED name",
                );
            }
        });

        it("binds arrays and explicit names in prepared batches", async function () {
            const client = await createClient(["items_after_upgrade"]);
            const [before] = await rust.testsBindMarkerProxyStats();
            await client.batch(
                [
                    {
                        query: `UPDATE ${table} SET value = ? WHERE pk = ? AND ck IN ?`,
                        params: [31, 1, [1]],
                    },
                    {
                        query: `UPDATE ${table} SET value = :value WHERE pk = :key AND ck IN :items`,
                        params: { items: [2], key: 1, value: 32 },
                    },
                ],
                { prepare: true },
            );
            const result = await client.execute(
                `SELECT ck, value FROM ${table} WHERE pk = 1`,
            );
            assert.deepStrictEqual(
                result.rows.map((row) => row.value),
                [31, 32],
            );
            const [after] = await rust.testsBindMarkerProxyStats();
            assert.strictEqual(after.batches - before.batches, 1);
            assert.ok(after.names.includes("items_after_upgrade"));
        });

        it("returns added result columns after schema change and UNPREPARED recovery", async function () {
            const client = await createClient(["IN(ck)"]);
            const query = `SELECT * FROM ${table} WHERE pk = ? AND ck IN ?`;
            const prepared = await client.prepareStatement(query);
            const before = await client.execute(query, [1, [1]], {
                prepare: true,
            });
            assert.strictEqual(before.rows[0].extra, undefined);
            await helper.ddl(
                setup.client,
                `ALTER TABLE ${table} ADD extra int`,
            );
            await setup.client.execute(
                `UPDATE ${table} SET extra = 42 WHERE pk = 1 AND ck = 1`,
            );
            const [initial] = await rust.testsBindMarkerProxyStats();
            await rust.testsConfigureBindMarkerProxy(
                0,
                "items_after_upgrade",
                true,
            );
            const after = await client.execute(query, [1, [1]], {
                prepare: true,
            });
            assert.strictEqual(after.rows[0].extra, 42);
            assert.ok(after.columns.some((column) => column.name === "extra"));
            const [stats] = await rust.testsBindMarkerProxyStats();
            assert.strictEqual(stats.unprepared - initial.unprepared, 1);
            assert.ok(stats.prepares > initial.prepares);
            assert.strictEqual(await client.prepareStatement(query), prepared);
        });
    });
};
