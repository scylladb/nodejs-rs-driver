"use strict";
const assert = require("chai").assert;

const helper = require("../../test-helper");
const utils = require("../../../lib/utils");
const { ColumnKind } = require("../../../lib/metadata/table-metadata");
const { CqlType } = require("../../../index");

describe("Metadata#getMaterializedView()", function () {
    this.timeout(60000);

    const setupInfo = helper.setup("1:0");

    describe("when called with view name", function () {
        it("should return null for non-existent materialized view", function (done) {
            const client = setupInfo.client;
            const view = client.metadata.getMaterializedView(
                setupInfo.keyspace,
                "non_existent_view",
            );
            assert.isNull(view);
            done();
        });

        it("should return MaterializedView for created view", function (done) {
            const keyspace = setupInfo.keyspace;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE TABLE ${keyspace}.mv_base_table (id uuid PRIMARY KEY, name varchar)`,
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE MATERIALIZED VIEW ${keyspace}.mv_by_name AS ` +
                            `SELECT * FROM ${keyspace}.mv_base_table ` +
                            "WHERE name IS NOT NULL AND id IS NOT NULL " +
                            "PRIMARY KEY (name, id)",
                    ),
                    function verifyView(next) {
                        const client = setupInfo.client;
                        const view = client.metadata.getMaterializedView(
                            keyspace,
                            "mv_by_name",
                        );
                        assert.isNotNull(view);
                        assert.strictEqual(view.tableName, "mv_base_table");
                        assert.isDefined(view.columns);
                        assert.isDefined(view.columns["id"]);
                        assert.isDefined(view.columns["name"]);

                        const nameColumn = view.columns["name"];
                        assert.strictEqual(
                            nameColumn.kind,
                            ColumnKind.PartitionKey,
                        );
                        assert.strictEqual(
                            nameColumn.type.code,
                            CqlType.Varchar,
                        );

                        assert.deepEqual(view.partitionKey, ["name"]);
                        assert.deepEqual(view.clusteringKey, ["id"]);
                        next();
                    },
                ],
                done,
            );
        });

        it("should return null after dropping the materialized view", function (done) {
            const keyspace = setupInfo.keyspace;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE TABLE ${keyspace}.mv_drop_base (id uuid PRIMARY KEY, name varchar)`,
                    ),
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE MATERIALIZED VIEW ${keyspace}.mv_drop_view AS ` +
                            `SELECT * FROM ${keyspace}.mv_drop_base ` +
                            "WHERE name IS NOT NULL AND id IS NOT NULL " +
                            "PRIMARY KEY (name, id)",
                    ),
                    function verifyExistence(next) {
                        const view =
                            setupInfo.client.metadata.getMaterializedView(
                                keyspace,
                                "mv_drop_view",
                            );
                        assert.isNotNull(view);
                        next();
                    },
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `DROP MATERIALIZED VIEW ${keyspace}.mv_drop_view`,
                    ),
                    function verifyDeletion(next) {
                        const view =
                            setupInfo.client.metadata.getMaterializedView(
                                keyspace,
                                "mv_drop_view",
                            );
                        assert.isNull(view);
                        next();
                    },
                ],
                done,
            );
        });
    });
});
