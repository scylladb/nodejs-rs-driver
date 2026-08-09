"use strict";
const assert = require("chai").assert;

const helper = require("../../../test-helper");
const utils = require("../../../../lib/utils");
const { ColumnKind } = require("../../../../lib/metadata/table-metadata");
const { CqlType } = require("../../../../index");

describe("Metadata#getTable()", function () {
    this.timeout(60000);

    const setupInfo = helper.setup("1:0");

    describe("when called with table name", function () {
        it("should return null for non-existent table", function (done) {
            const client = setupInfo.client;
            const table = client.metadata.getTable(
                "system",
                "non_existent_table",
            );
            assert.isNull(table);
            done();
        });

        it("should return TableMetadata for existing system table", function (done) {
            const client = setupInfo.client;
            const table = client.metadata.getTable("system", "local");
            assert.isNotNull(table);
            assert.isDefined(table.columns);
            done();
        });

        it("should return TableMetadata for created table", function (done) {
            const keyspace = setupInfo.keyspace;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE TABLE ${keyspace}.test_table (id uuid PRIMARY KEY, name varchar)`,
                    ),
                    function verifyTable(next) {
                        const client = setupInfo.client;
                        const table = client.metadata.getTable(
                            keyspace,
                            "test_table",
                        );
                        assert.isNotNull(table);
                        assert.isDefined(table.columns);
                        assert.strictEqual(
                            Object.keys(table.columns).length,
                            2,
                        );

                        const idColumn = table.columns["id"];
                        assert.isDefined(idColumn);
                        assert.strictEqual(
                            idColumn.kind,
                            ColumnKind.PartitionKey,
                        );
                        assert.strictEqual(idColumn.type.code, CqlType.Uuid);

                        const nameColumn = table.columns["name"];
                        assert.isDefined(nameColumn);
                        assert.strictEqual(nameColumn.kind, ColumnKind.Regular);
                        assert.strictEqual(
                            nameColumn.type.code,
                            CqlType.Varchar,
                        );
                        next();
                    },
                ],
                done,
            );
        });

        it("should return the same underlying table object across repeated calls", function (done) {
            const keyspace = setupInfo.keyspace;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE TABLE ${keyspace}.identity_tbl (id uuid PRIMARY KEY)`,
                    ),
                    function verifyIdentity(next) {
                        const tb1 = setupInfo.client.metadata.getTable(
                            keyspace,
                            "identity_tbl",
                        );
                        const tb2 = setupInfo.client.metadata.getTable(
                            keyspace,
                            "identity_tbl",
                        );

                        // The same underlying table/column objects.
                        assert.strictEqual(tb1, tb2);
                        assert.strictEqual(
                            tb1.columns["id"],
                            tb2.columns["id"],
                        );
                        next();
                    },
                ],
                done,
            );
        });

        it("should return null after dropping table", function (done) {
            const keyspace = setupInfo.keyspace;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE TABLE ${keyspace}.test_drop (id uuid PRIMARY KEY)`,
                    ),
                    function verifyExistence(next) {
                        const table = setupInfo.client.metadata.getTable(
                            keyspace,
                            "test_drop",
                        );
                        assert.isNotNull(table);
                        next();
                    },
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `DROP TABLE ${keyspace}.test_drop`,
                    ),
                    function verifyDeletion(next) {
                        const table = setupInfo.client.metadata.getTable(
                            keyspace,
                            "test_drop",
                        );
                        assert.isNull(table);
                        next();
                    },
                ],
                done,
            );
        });
    });
});
