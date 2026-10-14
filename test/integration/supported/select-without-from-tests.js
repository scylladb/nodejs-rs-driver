"use strict";
const assert = require("assert");

const helper = require("../../test-helper");
const Client = require("../../../lib/client");
const types = require("../../../lib/types");

function isSelectWithoutFromUnsupported(err) {
    // The Rust binding exposes the error class and message, but no CQL code.
    // Match its database SyntaxError discriminator only, not arbitrary text
    // from transport, authentication, invalid-query, or decoding failures.
    return (
        err.name === "ExecutionError" &&
        /^Database returned an error: The submitted query has a syntax error, Error message:/.test(
            err.message,
        )
    );
}

function assertLiteralResult(result) {
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.columns.length, 1);
    assert.strictEqual(result.columns[0].name, "1");
    assert.strictEqual(result.columns[0].type.code, types.dataTypes.int);
    assert.strictEqual(result.rows[0].get(0), 1);
    assert.strictEqual(result.rows[0].get("1"), 1);
}

function assertNowResult(result) {
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.columns.length, 1);
    assert.strictEqual(result.columns[0].name, "system.now()");
    assert.strictEqual(result.columns[0].type.code, types.dataTypes.timeuuid);
    assert.ok(result.rows[0].get(0) instanceof types.TimeUuid);
    assert.strictEqual(result.rows[0].get(0).getBuffer()[6] >> 4, 1);
    assert.ok(Number.isFinite(result.rows[0].get(0).getDate().getTime()));
}

describe("SELECT without FROM @SERVER_API", function () {
    this.timeout(120000);

    // Start the cluster without helper.setup's CREATE KEYSPACE and USE hooks.
    helper.setup(1, { initClient: false });
    const client = new Client(helper.baseOptions);
    before(() => client.connect());
    after(() => client.shutdown());

    before(async function () {
        assert.strictEqual(client.keyspace, undefined);
        try {
            await client.execute("SELECT 1");
        } catch (err) {
            if (isSelectWithoutFromUnsupported(err)) {
                this.skip();
            }
            throw err;
        }
    });

    [false, true].forEach((prepare) => {
        describe(prepare ? "prepared" : "simple", function () {
            it("should decode SELECT 1 and its metadata without a keyspace", async function () {
                assertLiteralResult(
                    await client.execute("SELECT 1", [], { prepare }),
                );
                assert.strictEqual(client.keyspace, undefined);
            });

            it("should decode SELECT now() and its metadata without a keyspace", async function () {
                assertNowResult(
                    await client.execute("SELECT now()", [], { prepare }),
                );
                assert.strictEqual(client.keyspace, undefined);
            });
        });
    });
});
