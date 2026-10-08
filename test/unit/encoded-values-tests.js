"use strict";

const { assert } = require("chai");
const rust = require("../../index");

describe("preserialized input values", function () {
    it("copies the exact encoded bytes and preserves null and unset", async function () {
        const source = Buffer.from([0, 1, 255]);
        const result = rust.testsSerializedValuesAsync([
            source,
            null,
            undefined,
            new Uint8Array([2, 3]),
            Buffer.alloc(0),
        ]);
        source.fill(9);
        const values = await result;
        assert.deepEqual(values, ["0001ff", "null", "unset", "0203", ""]);
    });

    it("rejects values that are not encoded byte arrays", function () {
        assert.throws(
            () => rust.testsSerializedValues([42]),
            /Expected a Buffer/,
        );
        assert.throws(
            () => rust.testsSerializedValues(["x"]),
            /Expected a Buffer/,
        );
        assert.throws(
            () => rust.testsSerializedValues([new Int8Array(1)]),
            /Expected a Buffer/,
        );
        assert.throws(
            () =>
                rust.testsSerializedValues([new DataView(new ArrayBuffer(1))]),
            /Expected a Buffer/,
        );
        assert.throws(
            () => rust.testsSerializedValues({}),
            /Expected an array/,
        );
    });

    it("reads a Buffer view from its byte offset", function () {
        const source = Buffer.from([9, 1, 2, 9]);
        assert.deepEqual(rust.testsSerializedValues([source.subarray(1, 3)]), [
            "0102",
        ]);
    });

    it("rejects more than 65,535 values", function () {
        assert.lengthOf(
            rust.testsSerializedValues(Array(65535).fill(null)),
            65535,
        );
        assert.throws(
            () => rust.testsSerializedValues(Array(65536).fill(null)),
            /Too many values/,
        );
    });
});
