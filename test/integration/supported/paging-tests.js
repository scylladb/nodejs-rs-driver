"use strict";

const { assert } = require("chai");
const Client = require("../../../lib/client");
const rust = require("../../../index");
const types = require("../../../lib/types");
const helper = require("../../test-helper");
const promiseUtils = require("../../../lib/promise-utils");

// Exported to be called on other fixtures to take advantage from existing setups
module.exports = function (keyspace, prepare) {
    context("with paging", function () {
        const client = new Client({
            contactPoints: helper.baseOptions.contactPoints,
            localDataCenter: helper.baseOptions.localDataCenter,
            keyspace,
        });

        const insertQuery =
            "INSERT INTO tbl_paging (id1, id2, value) VALUES (?, ?, ?)";
        const query = "SELECT * FROM tbl_paging WHERE id1 = ?";
        const insertOptions = {
            prepare: true,
            consistency: types.consistencies.all,
        };
        const keyA = "a";
        const keyB = "b";
        const rowsInPartitionA = 100;
        const rowsInPartitionB = 5;

        before(() => client.connect());
        before(() =>
            helper.ddl(
                client,
                "CREATE TABLE tbl_paging (id1 text, id2 int, value text, PRIMARY KEY (id1, id2))",
            ),
        );

        before(() =>
            // Insert 100 rows in a partition
            promiseUtils.times(rowsInPartitionA, 20, (n) =>
                client.execute(
                    insertQuery,
                    [keyA, n, n.toString()],
                    insertOptions,
                ),
            ),
        );

        before(() =>
            // Insert few rows in another partition
            promiseUtils.times(rowsInPartitionB, 5, (n) =>
                client.execute(insertQuery, ["b", n, `b${n}`], insertOptions),
            ),
        );

        it("compares native column snapshots across row and non-row results", async () => {
            await helper.ddl(
                client,
                "CREATE TABLE tbl_nested_metadata (id int PRIMARY KEY, nested map<text, frozen<list<text>>>, numbers map<text, frozen<list<int>>>)",
            );
            await helper.ddl(
                client,
                "CREATE TABLE tbl_other_metadata (id int PRIMARY KEY, nested map<text, frozen<list<text>>>)",
            );
            const options = client.createOptions().getRustOptions();
            const first = await client.rustClient.queryUnpaged(
                "SELECT * FROM tbl_nested_metadata",
                [],
                options,
            );
            const snapshot = first.getColumnsSnapshot();
            assert.isNotNull(snapshot);

            const next = await client.rustClient.queryUnpaged(
                "SELECT * FROM tbl_nested_metadata",
                [],
                options,
            );
            assert.isTrue(next.hasSameColumnsAs(snapshot));

            const differentType = await client.rustClient.queryUnpaged(
                "SELECT id AS value FROM tbl_nested_metadata",
                [],
                options,
            );
            const aliasedNested = await client.rustClient.queryUnpaged(
                "SELECT nested AS value FROM tbl_nested_metadata",
                [],
                options,
            );
            assert.isFalse(
                differentType.hasSameColumnsAs(
                    aliasedNested.getColumnsSnapshot(),
                ),
            );
            const differentNestedType = await client.rustClient.queryUnpaged(
                "SELECT numbers AS value FROM tbl_nested_metadata",
                [],
                options,
            );
            assert.isFalse(
                differentNestedType.hasSameColumnsAs(
                    aliasedNested.getColumnsSnapshot(),
                ),
            );

            const changed = await client.rustClient.queryUnpaged(
                "SELECT nested FROM tbl_nested_metadata",
                [],
                options,
            );
            assert.isFalse(changed.hasSameColumnsAs(snapshot));

            const otherTable = await client.rustClient.queryUnpaged(
                "SELECT * FROM tbl_other_metadata",
                [],
                options,
            );
            assert.isFalse(otherTable.hasSameColumnsAs(snapshot));

            const write = await client.rustClient.queryUnpaged(
                "INSERT INTO tbl_nested_metadata (id) VALUES (1)",
                [],
                options,
            );
            assert.isNull(write.getColumnsSnapshot());
            assert.isFalse(write.hasSameColumnsAs(snapshot));

            await client.execute(
                "INSERT INTO tbl_nested_metadata (id, nested) VALUES (2, {'k': ['a']})",
            );
            await client.execute(
                "INSERT INTO tbl_nested_metadata (id, nested) VALUES (3, {'k': ['b']})",
            );

            const result = await client.execute(
                "SELECT * FROM tbl_nested_metadata",
                [],
                { prepare, fetchSize: 1 },
            );
            const rows = await helper.asyncIteratorToArray(result);
            assert.deepEqual(
                rows.map((row) => row.id),
                [1, 2, 3],
            );
            assert.strictEqual(rows[1].nested.k[0], "a");

            let typeConversions = 0;
            const originalGetTypes =
                rust.QueryResultWrapper.prototype.getColumnsTypes;
            rust.QueryResultWrapper.prototype.getColumnsTypes = function (
                ...args
            ) {
                typeConversions++;
                return originalGetTypes.apply(this, args);
            };
            try {
                await new Promise((resolve, reject) => {
                    client.eachRow(
                        "SELECT * FROM tbl_nested_metadata",
                        [],
                        { prepare, fetchSize: 1, autoPage: true },
                        () => {},
                        (error) => (error ? reject(error) : resolve()),
                    );
                });
                assert.strictEqual(typeConversions, 1);
            } finally {
                rust.QueryResultWrapper.prototype.getColumnsTypes =
                    originalGetTypes;
            }
        });

        it("should use pageState and fetchSize", async () => {
            const fetchSize = 70;

            let rs = await client.execute(query, [keyA], {
                prepare,
                fetchSize,
            });
            assert.strictEqual(rs.rows.length, 70);

            const pageState = rs.pageState;
            const rawPageState = rs.rawPageState;

            // Select data remaining
            rs = await client.execute(query, [keyA], { prepare, pageState });
            assert.strictEqual(rs.rows.length, 30);

            // Select partial data remaining
            rs = await client.execute(query, [keyA], {
                prepare,
                pageState,
                fetchSize: 10,
            });
            assert.strictEqual(rs.rows.length, 10);

            // Select data remaining with raw page state
            rs = await client.execute(query, [keyA], {
                prepare,
                pageState: rawPageState,
            });
            assert.strictEqual(rs.rows.length, 30);
        });

        if (Symbol.asyncIterator) {
            it("should retrieve the following pages with async iterator", async () => {
                // Use a small fetch size for testing, usually should be in the hundreds or thousands
                const fetchSize = 11;
                const rs = await client.execute(query, [keyA], {
                    prepare,
                    fetchSize,
                });

                assert.lengthOf(rs.rows, fetchSize);
                const rows = await helper.asyncIteratorToArray(rs);
                assert.lengthOf(rows, rowsInPartitionA);
                // Validate that they are fetched in the correct clustering order
                rows.forEach((row, index) =>
                    assert.strictEqual(row["id2"], index),
                );
            });

            it("should retrieve the following pages across multiple partitions", async () => {
                const fetchSize = 39;
                const rs = await client.execute(
                    "SELECT * FROM tbl_paging",
                    [],
                    {
                        prepare,
                        fetchSize,
                    },
                );
                assert.lengthOf(rs.rows, fetchSize);
                const rows = await helper.asyncIteratorToArray(rs);
                assert.lengthOf(rows, rowsInPartitionA + rowsInPartitionB);
            });

            it("should allow multiple sequential async iterations", async () => {
                const fetchSize = 31;
                const rs = await client.execute(query, [keyA], {
                    prepare,
                    fetchSize,
                });

                assert.lengthOf(rs.rows, fetchSize);
                const rows1 = await helper.asyncIteratorToArray(rs);
                const rows2 = await helper.asyncIteratorToArray(rs);
                assert.lengthOf(rows1, rowsInPartitionA);
                assert.lengthOf(rows2, rowsInPartitionA);
                assert.deepEqual(
                    rows1.map((row) => row["id2"]),
                    rows2.map((row) => row["id2"]),
                );
            });

            it("should return the first page when only there is a single result page", async () => {
                const rs = await client.execute(query, [keyB], {
                    prepare,
                    fetchSize: 1000,
                });
                assert.lengthOf(rs.rows, rowsInPartitionB);
                const rows = await helper.asyncIteratorToArray(rs);
                assert.lengthOf(rows, rowsInPartitionB);
            });

            it("should return an empty iterator when there are no matching results", async () => {
                const rs = await client.execute(query, ["zzz"], {
                    prepare,
                    fetchSize: 1000,
                });
                assert.lengthOf(rs.rows, 0);
                const rows = await helper.asyncIteratorToArray(rs);
                assert.lengthOf(rows, 0);
            });

            it("should return an empty iterator for VOID results", async () => {
                const options = { prepare, fetchSize: 1000 };

                if (!prepare) {
                    options.hints = ["text", "int", "text"];
                }

                const rs = await client.execute(
                    insertQuery,
                    ["new-key", 1, "new!"],
                    options,
                );
                assert.strictEqual(rs.rows, undefined);
                const rows = await helper.asyncIteratorToArray(rs);
                assert.lengthOf(rows, 0);
            });
        }
    });
};
