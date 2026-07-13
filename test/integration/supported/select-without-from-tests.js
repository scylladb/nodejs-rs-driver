"use strict";
const assert = require("assert");

const helper = require("../../test-helper");
const types = require("../../../lib/types");

function getResponseCode(err) {
    if (!err) {
        return undefined;
    }
    if (typeof err.code === "number") {
        return err.code;
    }
    if (err.innerErrors) {
        return Object.keys(err.innerErrors)
            .map((key) => getResponseCode(err.innerErrors[key]))
            .find((code) => typeof code === "number");
    }
    return undefined;
}

function isSelectWithoutFromUnsupported(err) {
    const code = getResponseCode(err);
    return (
        code === types.responseErrorCodes.syntaxError ||
        code === types.responseErrorCodes.invalid ||
        /select without from|mismatched input|no viable alternative|syntax error/i.test(
            err.message || "",
        )
    );
}

function assertLiteralResult(result) {
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.columns.length, 1);
    assert.strictEqual(result.columns[0].name, "1");
    assert.strictEqual(result.columns[0].type.code, types.dataTypes.int);
    assert.strictEqual(result.rows[0].get(0), 1);
}

function assertNowResult(result) {
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.columns.length, 1);
    assert.strictEqual(result.columns[0].name, "now()");
    assert.strictEqual(result.columns[0].type.code, types.dataTypes.timeuuid);
    assert.ok(result.rows[0].get(0) instanceof types.TimeUuid);
}

describe("SELECT without FROM @SERVER_API", function () {
    this.timeout(120000);

    const setupInfo = helper.setup(1);

    it("should execute simple and prepared queries", async function () {
        const client = setupInfo.client;
        let result;
        try {
            result = await client.execute("SELECT 1");
        } catch (err) {
            if (isSelectWithoutFromUnsupported(err)) {
                this.skip();
            }
            throw err;
        }

        assertLiteralResult(result);
        assertNowResult(await client.execute("SELECT now()"));
        assertLiteralResult(
            await client.execute("SELECT 1", [], { prepare: true }),
        );
        assertNowResult(
            await client.execute("SELECT now()", [], { prepare: true }),
        );
    });
});
