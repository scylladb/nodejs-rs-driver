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

describe("batch values", function () {
    const encoder = new Encoder(4, {});
    const int = { code: types.dataTypes.int };

    function batchFrame(rows) {
        const count = Buffer.alloc(2);
        count.writeUInt16BE(rows.length);
        return Buffer.concat([count, ...rows.map(frame)]);
    }

    it("copies the bytes before the native call returns", async function () {
        const source = batchFrame([[[1, 2]], [null, [3]]]);
        const result = rust.testsBatchValuesAsync(source);
        source.fill(9);
        assert.deepEqual(await result, [["0102"], ["null", "03"]]);
    });

    it("reads one row per statement", function () {
        assert.deepEqual(
            rust.testsBatchValues(batchFrame([[[1]], [], [null, undefined]])),
            [["01"], [], ["null", "unset"]],
        );
    });

    it("rejects a malformed batch frame", function () {
        assert.throws(
            () => rust.testsBatchValues(Buffer.from([0])),
            /Malformed encoded batch values/,
        );
        // The count says 2 statements, the frame holds 1.
        assert.throws(
            () =>
                rust.testsBatchValues(
                    Buffer.concat([Buffer.from([0, 2]), frame([])]),
                ),
            /Malformed encoded batch values/,
        );
        assert.throws(
            () =>
                rust.testsBatchValues(
                    Buffer.concat([batchFrame([[]]), Buffer.from([0])]),
                ),
            /trailing bytes/,
        );
        assert.throws(
            () => rust.testsBatchValues([]),
            /Expected encoded batch values in a Buffer/,
        );
    });

    it("FrameWriter.batch writes each statement with its own types", function () {
        const encoded = writer.batch(
            [[int], [], [null, int]],
            [[1], [], ["a", 2]],
            encoder,
        );
        assert.deepEqual(rust.testsBatchValues(encoded), [
            ["00000001"],
            [],
            ["61", "00000002"],
        ]);
    });

    it("FrameWriter.batch grows the writer's buffer across statements", function () {
        const big = "y".repeat(5000);
        const rows = Array.from({ length: 50 }, () => [big]);
        const values = rust.testsBatchValues(
            writer.batch(
                rows.map(() => []),
                rows,
                encoder,
            ),
        );
        assert.lengthOf(values, 50);
        assert.lengthOf(values[49][0], 10000);
    });
});
