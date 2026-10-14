"use strict";

const { assert } = require("chai");
const rust = require("../../index");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");
const { FrameWriter } = require("../../lib/frame-writer");

// One writer for the tests that do not test the writer itself.
const writer = new FrameWriter();

// This file can run alone, without lib/client.ts, which initializes the bridge.
rust.initAsyncBridge();

/** Builds a values frame: [u16 count], then [i32 length][bytes] per value. */
function frame(values) {
    const parts = [Buffer.alloc(2)];
    parts[0].writeUInt16BE(values.length);
    for (const value of values) {
        const length = Buffer.alloc(4);
        if (value === null) length.writeInt32BE(-1);
        else if (value === undefined) length.writeInt32BE(-2);
        else length.writeInt32BE(value.length);
        parts.push(length);
        if (value) parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts);
}

describe("preserialized input values", function () {
    it("copies the exact encoded bytes and preserves null and unset", async function () {
        const source = frame([[0, 1, 255], null, undefined, [2, 3], []]);
        const result = rust.testsSerializedValuesAsync(source);
        source.fill(9);
        const values = await result;
        assert.deepEqual(values, ["0001ff", "null", "unset", "0203", ""]);
    });

    it("accepts a Uint8Array", function () {
        assert.deepEqual(
            rust.testsSerializedValues(new Uint8Array(frame([[7]]))),
            ["07"],
        );
    });

    it("rejects values that are not a byte array", function () {
        for (const bad of [
            [frame([])],
            42,
            "x",
            null,
            {},
            new Int8Array(2),
            new DataView(new ArrayBuffer(2)),
        ]) {
            assert.throws(
                () => rust.testsSerializedValues(bad),
                /Expected encoded values in a Buffer/,
            );
        }
    });

    it("rejects a malformed frame", function () {
        // Too short for the count.
        assert.throws(
            () => rust.testsSerializedValues(Buffer.from([0])),
            /Malformed encoded values/,
        );
        // The count says more values than the frame holds.
        assert.throws(
            () => rust.testsSerializedValues(Buffer.from([0, 1])),
            /Malformed encoded values/,
        );
        // A length that is past the end of the frame.
        assert.throws(
            () =>
                rust.testsSerializedValues(Buffer.from([0, 1, 0, 0, 0, 5, 1])),
            /Malformed encoded values/,
        );
        // A negative length other than null and unset.
        assert.throws(
            () =>
                rust.testsSerializedValues(
                    Buffer.from([0, 1, 255, 255, 255, 253]),
                ),
            /Malformed encoded values/,
        );
        // Bytes after the last value.
        assert.throws(
            () =>
                rust.testsSerializedValues(
                    Buffer.concat([frame([]), Buffer.from([0])]),
                ),
            /trailing bytes/,
        );
    });

    it("reads a Buffer view from its byte offset", function () {
        const inner = frame([[1, 2]]);
        const source = Buffer.concat([
            Buffer.from([9]),
            inner,
            Buffer.from([9]),
        ]);
        assert.deepEqual(
            rust.testsSerializedValues(source.subarray(1, 1 + inner.length)),
            ["0102"],
        );
    });

    it("accepts 65,535 values", function () {
        assert.lengthOf(
            rust.testsSerializedValues(frame(Array(65535).fill(null))),
            65535,
        );
    });
});

describe("FrameWriter.params with Rust", function () {
    const encoder = new Encoder(4, {});

    it("keeps the copy Rust made when the writer's buffer is reused", async function () {
        const pending = rust.testsSerializedValuesAsync(
            writer.params([{ code: types.dataTypes.int }], [1], encoder),
        );
        writer.params([{ code: types.dataTypes.int }], [2], encoder);
        assert.deepEqual(await pending, ["00000001"]);
    });
});
