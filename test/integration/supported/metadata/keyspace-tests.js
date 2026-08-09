"use strict";
const assert = require("chai").assert;

const helper = require("../../../test-helper");
const utils = require("../../../../lib/utils");
const { StrategyKind } = require("../../../../lib/metadata/keyspace-metadata");

describe("Metadata#getKeyspace()", function () {
    this.timeout(60000);

    const setupInfo = helper.setup("2:0");

    describe("when called with keyspace name", function () {
        it("should return null for non-existent keyspace", function (done) {
            const client = setupInfo.client;
            const ks = client.metadata.getKeyspace("non_existent_keyspace");
            assert.isNull(ks);
            done();
        });

        it("should return KeyspaceMetadata for created keyspace", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks.test_table (id uuid PRIMARY KEY, name varchar)",
                    ),
                    function verifyKeyspace(next) {
                        const client = setupInfo.client;
                        const ks = client.metadata.getKeyspace("test_ks");
                        assert.isNotNull(ks);
                        assert.isDefined(ks.strategy);
                        assert.strictEqual(
                            ks.strategy.kind,
                            StrategyKind.NetworkTopologyStrategy,
                        );
                        assert.isNull(ks.strategy.replicationFactor);
                        assert.isDefined(ks.strategy.datacenterRepfactors);
                        assert.strictEqual(
                            ks.strategy.datacenterRepfactors.dc1,
                            1,
                        );

                        assert.isDefined(ks.tables);
                        assert.isDefined(ks.tables["test_table"]);
                        const testTable = ks.tables["test_table"];
                        assert.isDefined(testTable.columns);
                        assert.isDefined(testTable.columns["id"]);
                        assert.isDefined(testTable.columns["name"]);
                        next();
                    },
                ],
                done,
            );
        });

        it("should return correct metadata for SimpleStrategy keyspace", function (done) {
            const query = helper.keyspaceDefinitionWithTabletsDisabled(
                setupInfo.client,
                "CREATE KEYSPACE test_ss WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}",
            );
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        query,
                    ),
                    function verifyKeyspace(next) {
                        const client = setupInfo.client;
                        const ks = client.metadata.getKeyspace("test_ss");
                        assert.isNotNull(ks);
                        assert.isDefined(ks.strategy);
                        assert.strictEqual(
                            ks.strategy.kind,
                            StrategyKind.SimpleStrategy,
                        );
                        assert.isNull(ks.strategy.datacenterRepfactors);
                        assert.isNumber(ks.strategy.replicationFactor);
                        assert.strictEqual(ks.strategy.replicationFactor, 1);
                        next();
                    },
                ],
                done,
            );
        });

        it("should reflect keyspace changes after alter", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_alter WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    function verifyInitialKeyspace(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace("test_alter");
                        assert.isNotNull(ks);
                        assert.strictEqual(
                            ks.strategy.datacenterRepfactors.dc1,
                            1,
                        );
                        next();
                    },
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "ALTER KEYSPACE test_alter WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 2}",
                    ),
                    function verifyAlteredKeyspace(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace("test_alter");
                        assert.isNotNull(ks);
                        assert.strictEqual(
                            ks.strategy.datacenterRepfactors.dc1,
                            2,
                        );
                        next();
                    },
                ],
                done,
            );
        });

        it("should return null after dropping keyspace", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_drop WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    function verifyExistence(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace("test_drop");
                        assert.isNotNull(ks);
                        next();
                    },
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "DROP KEYSPACE test_drop",
                    ),
                    function verifyDeletion(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace("test_drop");
                        assert.isNull(ks);
                        next();
                    },
                ],
                done,
            );
        });

        it("should return empty tables/views/udts maps for a keyspace with none", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_empty_ks WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    function verifyKeyspace(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace(
                                "test_empty_ks",
                            );
                        assert.isNotNull(ks);
                        assert.deepEqual(ks.tables, {});
                        assert.deepEqual(ks.views, {});
                        assert.deepEqual(ks.udts, {});
                        next();
                    },
                ],
                done,
            );
        });

        it("should report durableWrites correctly", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_durable_writes_off WITH replication = " +
                            "{'class': 'NetworkTopologyStrategy', 'dc1': 1} " +
                            "AND durable_writes = false",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_durable_writes_on WITH replication = " +
                            "{'class': 'NetworkTopologyStrategy', 'dc1': 1} " +
                            "AND durable_writes = true",
                    ),
                    function verifyKeyspaces(next) {
                        const off = setupInfo.client.metadata.getKeyspace(
                            "test_durable_writes_off",
                        );
                        const on = setupInfo.client.metadata.getKeyspace(
                            "test_durable_writes_on",
                        );
                        assert.strictEqual(off.durableWrites, false);
                        assert.strictEqual(on.durableWrites, true);
                        next();
                    },
                ],
                done,
            );
        });

        it("should expose tables keyed by table name", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_tbls WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1};",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_tbls.tbl_1 (id uuid PRIMARY KEY, name varchar)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_tbls.tbl_2 (id uuid PRIMARY KEY, idx int)",
                    ),
                    function verifyKeyspace(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_tbls",
                            );
                        assert.isNotNull(ks);
                        assert.sameMembers(Object.keys(ks.tables), [
                            "tbl_1",
                            "tbl_2",
                        ]);
                        for (const tableName of Object.keys(ks.tables)) {
                            assert.isNotNull(ks.tables[tableName]);
                            let table = setupInfo.client.metadata.getTable(
                                "test_ks_tbls",
                                tableName,
                            );
                            assert.strictEqual(ks.tables[tableName], table);
                        }
                        next();
                    },
                ],
                done,
            );
        });

        it("should return the same table instance whether getTable() is called before or after tables", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_tbls_order WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1};",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_tbls_order.tbl_1 (id uuid PRIMARY KEY, name varchar)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_tbls_order.tbl_2 (id uuid PRIMARY KEY, idx int)",
                    ),
                    function verifyKeyspace(next) {
                        // getTable() first, populating the per-table cache with a single entry.
                        const table1 = setupInfo.client.metadata.getTable(
                            "test_ks_tbls_order",
                            "tbl_1",
                        );
                        assert.isNotNull(table1);

                        // ks.tables must still expose every table, not just tbl_1.
                        const ks =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_tbls_order",
                            );
                        assert.sameMembers(Object.keys(ks.tables), [
                            "tbl_1",
                            "tbl_2",
                        ]);
                        assert.strictEqual(ks.tables["tbl_1"], table1);

                        const table2 = setupInfo.client.metadata.getTable(
                            "test_ks_tbls_order",
                            "tbl_2",
                        );
                        assert.strictEqual(ks.tables["tbl_2"], table2);
                        next();
                    },
                ],
                done,
            );
        });

        it("should expose udts keyed by type name", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_udts WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TYPE test_ks_udts.udt_a (x int)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TYPE test_ks_udts.udt_b (y text)",
                    ),
                    function verifyKeyspace(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_udts",
                            );
                        assert.isNotNull(ks);
                        assert.sameMembers(Object.keys(ks.udts), [
                            "udt_a",
                            "udt_b",
                        ]);
                        for (const typeName of Object.keys(ks.udts)) {
                            assert.isNotNull(ks.udts[typeName]);
                            let udt = setupInfo.client.metadata.getUdt(
                                "test_ks_udts",
                                typeName,
                            );
                            assert.strictEqual(ks.udts[typeName], udt);
                        }
                        next();
                    },
                ],
                done,
            );
        });

        it("should return the same UDT instance whether getUdt() is called before or after udts", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_udts_order WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TYPE test_ks_udts_order.udt_a (x int)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TYPE test_ks_udts_order.udt_b (y text)",
                    ),
                    function verifyKeyspace(next) {
                        const udtA = setupInfo.client.metadata.getUdt(
                            "test_ks_udts_order",
                            "udt_a",
                        );
                        assert.isNotNull(udtA);

                        const ks =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_udts_order",
                            );
                        assert.sameMembers(Object.keys(ks.udts), [
                            "udt_a",
                            "udt_b",
                        ]);
                        assert.strictEqual(ks.udts["udt_a"], udtA);

                        const udtB = setupInfo.client.metadata.getUdt(
                            "test_ks_udts_order",
                            "udt_b",
                        );
                        assert.strictEqual(ks.udts["udt_b"], udtB);
                        next();
                    },
                ],
                done,
            );
        });

        it("should expose views keyed by view name", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_views WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_views.base_tbl (id uuid PRIMARY KEY, name varchar, nr int)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE MATERIALIZED VIEW test_ks_views.by_name AS " +
                            "SELECT * FROM test_ks_views.base_tbl " +
                            "WHERE name IS NOT NULL AND id IS NOT NULL " +
                            "PRIMARY KEY (name, id)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE MATERIALIZED VIEW test_ks_views.by_nr AS " +
                            "SELECT * FROM test_ks_views.base_tbl " +
                            "WHERE nr IS NOT NULL AND id IS NOT NULL " +
                            "PRIMARY KEY (nr, id)",
                    ),
                    function verifyKeyspace(next) {
                        const ks =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_views",
                            );
                        assert.isNotNull(ks);
                        assert.sameMembers(Object.keys(ks.views), [
                            "by_name",
                            "by_nr",
                        ]);
                        assert.strictEqual(
                            ks.views["by_name"].tableName,
                            "base_tbl",
                        );
                        assert.strictEqual(
                            ks.views["by_nr"].tableName,
                            "base_tbl",
                        );
                        for (const viewName of Object.keys(ks.views)) {
                            assert.isNotNull(ks.views[viewName]);
                            let view =
                                setupInfo.client.metadata.getMaterializedView(
                                    "test_ks_views",
                                    viewName,
                                );
                            assert.strictEqual(ks.views[viewName], view);
                        }
                        next();
                    },
                ],
                done,
            );
        });

        it("should return the same view instance whether getMaterializedView() is called before or after views", function (done) {
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_views_order WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_views_order.base_tbl (id uuid PRIMARY KEY, name varchar, nr int)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE MATERIALIZED VIEW test_ks_views_order.by_name AS " +
                            "SELECT * FROM test_ks_views_order.base_tbl " +
                            "WHERE name IS NOT NULL AND id IS NOT NULL " +
                            "PRIMARY KEY (name, id)",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE MATERIALIZED VIEW test_ks_views_order.by_nr AS " +
                            "SELECT * FROM test_ks_views_order.base_tbl " +
                            "WHERE nr IS NOT NULL AND id IS NOT NULL " +
                            "PRIMARY KEY (nr, id)",
                    ),
                    function verifyKeyspace(next) {
                        const byName =
                            setupInfo.client.metadata.getMaterializedView(
                                "test_ks_views_order",
                                "by_name",
                            );
                        assert.isNotNull(byName);

                        const ks = setupInfo.client.metadata.getKeyspace(
                            "test_ks_views_order",
                        );
                        assert.sameMembers(Object.keys(ks.views), [
                            "by_name",
                            "by_nr",
                        ]);
                        assert.strictEqual(ks.views["by_name"], byName);

                        const byNr =
                            setupInfo.client.metadata.getMaterializedView(
                                "test_ks_views_order",
                                "by_nr",
                            );
                        assert.strictEqual(ks.views["by_nr"], byNr);
                        next();
                    },
                ],
                done,
            );
        });

        it("should return the same underlying table object across repeated getKeyspace() calls", function (done) {
            // Metadata#getKeyspace() builds a fresh KeyspaceMetadata JS wrapper on every call,
            // but the native KeyspaceWrapper it delegates to is cached at the Rust level.
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_identity WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_identity.identity_tbl (id uuid PRIMARY KEY)",
                    ),
                    function verifyIdentity(next) {
                        const ks1 =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_identity",
                            );
                        const ks2 =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_identity",
                            );

                        // Different JS wrapper instances
                        assert.notStrictEqual(ks1, ks2);
                        // The same underlying table/column objects.
                        assert.strictEqual(
                            ks1.tables["identity_tbl"],
                            ks2.tables["identity_tbl"],
                        );
                        assert.strictEqual(
                            ks1.tables["identity_tbl"].columns["id"],
                            ks2.tables["identity_tbl"].columns["id"],
                        );
                        next();
                    },
                ],
                done,
            );
        });

        it("altering a keyspace should result in a cache refresh", function (done) {
            // Altering a keyspace should result in a complete refresh of the cache.
            let ks1, ks2, table1, table2;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE KEYSPACE test_ks_tbls_cache WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "CREATE TABLE test_ks_tbls_cache.tbl_1 (id uuid PRIMARY KEY, name varchar)",
                    ),
                    function verifyKeyspace(next) {
                        table1 = setupInfo.client.metadata.getTable(
                            "test_ks_tbls_cache",
                            "tbl_1",
                        );
                        assert.isNotNull(table1);

                        ks1 =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_tbls_cache",
                            );
                        assert.strictEqual(ks1.tables["tbl_1"], table1);
                        next();
                    },
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        "ALTER KEYSPACE test_ks_tbls_cache WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 2}",
                    ),
                    function verifyAlteredKeyspace(next) {
                        table2 = setupInfo.client.metadata.getTable(
                            "test_ks_tbls_cache",
                            "tbl_1",
                        );
                        assert.isNotNull(table2);

                        ks2 =
                            setupInfo.client.metadata.getKeyspace(
                                "test_ks_tbls_cache",
                            );
                        assert.strictEqual(ks2.tables["tbl_1"], table2);

                        // After altering, the cache should be refreshed.
                        assert.deepEqual(table1, table2);
                        assert.notStrictEqual(table1, table2);
                        next();
                    },
                ],
                done,
            );
        });
    });
});

describe("Metadata#getKeyspaces()", function () {
    this.timeout(60000);

    const setupInfo = helper.setup("2:0");

    it("should return a Map that includes every created keyspace", function (done) {
        utils.series(
            [
                helper.toTask(
                    setupInfo.client.execute,
                    setupInfo.client,
                    "CREATE KEYSPACE test_ksall_1 WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                ),
                helper.toTask(
                    setupInfo.client.execute,
                    setupInfo.client,
                    "CREATE KEYSPACE test_ksall_2 WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 2}",
                ),
                function verifyKeyspaces(next) {
                    const keyspaces = setupInfo.client.metadata.getKeyspaces();
                    assert.instanceOf(keyspaces, Map);
                    assert.isAbove(keyspaces.size, 2);

                    const ks1 = keyspaces.get("test_ksall_1");
                    assert.isDefined(ks1);
                    assert.strictEqual(
                        ks1.strategy.kind,
                        StrategyKind.NetworkTopologyStrategy,
                    );
                    assert.strictEqual(
                        ks1.strategy.datacenterRepfactors.dc1,
                        1,
                    );

                    const ks2 = keyspaces.get("test_ksall_2");
                    assert.isDefined(ks2);
                    assert.strictEqual(
                        ks2.strategy.kind,
                        StrategyKind.NetworkTopologyStrategy,
                    );
                    assert.strictEqual(
                        ks2.strategy.datacenterRepfactors.dc1,
                        2,
                    );
                    next();
                },
            ],
            done,
        );
    });

    it("should return the same underlying table object as getKeyspace() for the same keyspace", function (done) {
        // Metadata#getKeyspaces() and Metadata#getKeyspace() each build a fresh KeyspaceMetadata
        // JS wrapper, but both delegate to the same cached native KeyspaceWrapper.
        utils.series(
            [
                helper.toTask(
                    setupInfo.client.execute,
                    setupInfo.client,
                    "CREATE KEYSPACE test_ksall_identity WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                ),
                helper.toTask(
                    setupInfo.client.execute,
                    setupInfo.client,
                    "CREATE TABLE test_ksall_identity.identity_tbl (id uuid PRIMARY KEY)",
                ),
                function verifyIdentity(next) {
                    const fromAll = setupInfo.client.metadata
                        .getKeyspaces()
                        .get("test_ksall_identity");
                    const fromSingle = setupInfo.client.metadata.getKeyspace(
                        "test_ksall_identity",
                    );

                    // Different JS wrapper instances.
                    assert.notStrictEqual(fromAll, fromSingle);
                    // The same underlying table object.
                    assert.strictEqual(
                        fromAll.tables["identity_tbl"],
                        fromSingle.tables["identity_tbl"],
                    );
                    next();
                },
            ],
            done,
        );
    });

    it("should reflect keyspace changes after alter", function (done) {
        utils.series(
            [
                helper.toTask(
                    setupInfo.client.execute,
                    setupInfo.client,
                    "CREATE KEYSPACE test_ksall_alter WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 1}",
                ),
                function verifyInitialKeyspace(next) {
                    const ks = setupInfo.client.metadata
                        .getKeyspaces()
                        .get("test_ksall_alter");
                    assert.strictEqual(ks.strategy.datacenterRepfactors.dc1, 1);
                    next();
                },
                helper.toTask(
                    setupInfo.client.execute,
                    setupInfo.client,
                    "ALTER KEYSPACE test_ksall_alter WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1': 2}",
                ),
                function verifyAlteredKeyspace(next) {
                    const ks = setupInfo.client.metadata
                        .getKeyspaces()
                        .get("test_ksall_alter");
                    assert.strictEqual(ks.strategy.datacenterRepfactors.dc1, 2);
                    next();
                },
            ],
            done,
        );
    });
});
