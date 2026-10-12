"use strict";

const { assert } = require("chai");
const Client = require("../../../lib/client");
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

        async function readAllPages(fetchSize) {
            const ids = [];
            let pageState;
            do {
                const rs = await client.execute(query, [keyA], {
                    prepare,
                    fetchSize,
                    pageState,
                });
                assert.deepEqual(
                    rs.columns.map((c) => c.name),
                    ["id1", "id2", "value"],
                );
                ids.push(...rs.rows.map((row) => row["id2"]));
                pageState = rs.pageState;
            } while (pageState);
            return ids;
        }

        it("should follow pageState to the last page", async () => {
            const expected = Array.from(
                { length: rowsInPartitionA },
                (_, i) => i,
            );
            assert.deepEqual(await readAllPages(30), expected);
            // The second run reuses the statement, and for prepare: true also the cached handle.
            assert.deepEqual(await readAllPages(30), expected);
        });

        it("should retrieve all pages with eachRow and autoPage", async () => {
            const ids = [];
            await new Promise((resolve, reject) =>
                client.eachRow(
                    query,
                    [keyA],
                    { prepare, fetchSize: 17, autoPage: true },
                    (n, row) => ids.push(row["id2"]),
                    (err) => (err ? reject(err) : resolve()),
                ),
            );
            assert.deepEqual(
                ids,
                Array.from({ length: rowsInPartitionA }, (_, i) => i),
            );
        });

        it("should retrieve all pages with stream", async () => {
            const ids = [];
            const stream = client.stream(query, [keyA], {
                prepare,
                fetchSize: 23,
            });
            for await (const row of stream) {
                ids.push(row["id2"]);
            }
            assert.deepEqual(
                ids,
                Array.from({ length: rowsInPartitionA }, (_, i) => i),
            );
        });

        it("should return new result columns after a schema change", async () => {
            const table = helper.getRandomName("tbl_alter");
            await helper.ddl(
                client,
                `CREATE TABLE ${table} (id1 text, id2 int, PRIMARY KEY (id1, id2))`,
            );
            const insertOptions = {
                prepare: true,
                consistency: types.consistencies.all,
            };
            for (let i = 0; i < 5; i++) {
                await client.execute(
                    `INSERT INTO ${table} (id1, id2) VALUES (?, ?)`,
                    [keyA, i],
                    insertOptions,
                );
            }
            const select = `SELECT * FROM ${table} WHERE id1 = ?`;
            const run = async () => {
                const rs = await client.execute(select, [keyA], {
                    prepare,
                    fetchSize: 2,
                });
                const rows = await helper.asyncIteratorToArray(rs);
                assert.lengthOf(rows, 5);
                return rs.columns.map((c) => c.name);
            };
            assert.deepEqual(await run(), ["id1", "id2"]);
            await helper.ddl(client, `ALTER TABLE ${table} ADD extra text`);
            assert.deepEqual(await run(), ["id1", "id2", "extra"]);
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
