"use strict";
const assert = require("chai").assert;

const helper = require("../../../test-helper");
const { TokenRange } = require("../../../../lib/token");

describe("Metadata token ring", function () {
    this.timeout(120000);

    const setupInfo = helper.setup("2:0");

    describe("#getTokenRanges()", function () {
        it("should return contiguous ranges covering the whole ring", function () {
            const tokenRanges = [...setupInfo.client.metadata.getTokenRanges()];

            tokenRanges.forEach((range, index) => {
                assert.instanceOf(range, TokenRange);
                assert.isFalse(range.isEmpty());
                const next = tokenRanges[(index + 1) % tokenRanges.length];
                assert.isTrue(
                    range.end.equals(next.start),
                    `${range} is not followed by ${next}`,
                );
            });
            // Only the last range, can wrap around the end of the ring.
            assert.isAtMost(
                tokenRanges.filter((range) => range.isWrappedAround()).length,
                1,
            );
        });
    });

    describe("#newToken()", function () {
        const singleColumnTable = "tokens_single";
        const compositeTable = "tokens_composite";

        before(async function () {
            const client = setupInfo.client;
            await client.execute(
                `CREATE TABLE ${setupInfo.keyspace}.${singleColumnTable} (k text PRIMARY KEY)`,
            );
            await client.execute(
                `CREATE TABLE ${setupInfo.keyspace}.${compositeTable}` +
                    " (a text, b text, PRIMARY KEY ((a, b)))",
            );
            // token() is read back from the rows themselves, so the partitions have to exist.
            await client.execute(
                `INSERT INTO ${setupInfo.keyspace}.${singleColumnTable} (k) VALUES ('partition')`,
            );
            await client.execute(
                `INSERT INTO ${setupInfo.keyspace}.${compositeTable} (a, b)` +
                    " VALUES ('first', 'second')",
            );
        });

        it("should compute the same token as the server for a single column partition key", async function () {
            const result = await setupInfo.client.execute(
                `SELECT token(k) AS t FROM ${setupInfo.keyspace}.${singleColumnTable}` +
                    " WHERE k = 'partition'",
            );

            const token = setupInfo.client.metadata.newToken(
                Buffer.from("partition", "utf8"),
                setupInfo.keyspace,
                singleColumnTable,
            );
            assert.strictEqual(
                token.toString(),
                result.rows[0].t.toString(),
                "the driver and the server disagree on the token",
            );
        });

        it("should compute the same token as the server for a composite partition key", async function () {
            const result = await setupInfo.client.execute(
                `SELECT token(a, b) AS t FROM ${setupInfo.keyspace}.${compositeTable}` +
                    " WHERE a = 'first' AND b = 'second'",
            );

            const token = setupInfo.client.metadata.newToken(
                [Buffer.from("first", "utf8"), Buffer.from("second", "utf8")],
                setupInfo.keyspace,
                compositeTable,
            );
            assert.strictEqual(
                token.toString(),
                result.rows[0].t.toString(),
                "the driver and the server disagree on the token",
            );
        });

        it("should produce a token that falls into exactly one range of the ring", function () {
            const metadata = setupInfo.client.metadata;
            const token = metadata.newToken(
                Buffer.from("partition", "utf8"),
                setupInfo.keyspace,
                singleColumnTable,
            );

            const containing = [...metadata.getTokenRanges()].filter((range) =>
                range.contains(token),
            );

            assert.lengthOf(containing, 1);
        });
    });
});
