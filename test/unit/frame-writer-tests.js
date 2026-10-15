"use strict";

const { assert } = require("chai");
const { runInNewContext } = require("node:vm");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");
const { FrameWriter } = require("../../lib/frame-writer");

// One writer for the tests that do not test the writer itself.
const writer = new FrameWriter();

/**
 * Reads a values frame: [u16 count], then [i32 length][bytes] per value.
 * Returns hex strings, "null" and "unset", and checks that no bytes are left.
 */
function decodeFrame(buffer) {
    const count = buffer.readUInt16BE(0);
    let offset = 2;
    const values = [];
    for (let i = 0; i < count; i++) {
        const length = buffer.readInt32BE(offset);
        offset += 4;
        if (length === -1) {
            values.push("null");
        } else if (length === -2) {
            values.push("unset");
        } else {
            values.push(buffer.toString("hex", offset, offset + length));
            offset += length;
        }
    }
    assert.strictEqual(offset, buffer.length, "trailing bytes");
    return values;
}

describe("FrameWriter.params", function () {
    const encoder = new Encoder(4, {});
    const int = { code: types.dataTypes.int };
    const text = { code: types.dataTypes.text };

    it("writes values, null and unset in order", function () {
        assert.deepEqual(
            decodeFrame(
                writer.params(
                    [int, null, null, text],
                    [1, null, types.unset, "ab"],
                    encoder,
                ),
            ),
            ["00000001", "null", "unset", "6162"],
        );
    });

    it("writes an empty frame for no params", function () {
        assert.deepEqual(decodeFrame(writer.params([], [], encoder)), []);
        assert.deepEqual(
            decodeFrame(writer.params([], undefined, encoder)),
            [],
        );
    });

    it("grows the writer's buffer for large values", function () {
        const big = "x".repeat(100000);
        const values = decodeFrame(
            writer.params([text, int], [big, 5], encoder),
        );
        assert.lengthOf(values, 2);
        assert.lengthOf(values[0], 200000);
        assert.equal(values[1], "00000005");
    });

    it("reuses the writer's buffer in the next frame", function () {
        const first = writer.params([int], [1], encoder);
        writer.params([int], [2], encoder);
        assert.deepEqual(decodeFrame(first), ["00000002"]);
    });

    it("rejects more than 65,535 params", function () {
        assert.throws(
            () => writer.params([], Array(65536).fill(null), encoder),
            /Too many values/,
        );
        assert.lengthOf(
            decodeFrame(writer.params([], Array(65535).fill(null), encoder)),
            65535,
        );
    });
});

describe("FrameWriter.buffers", function () {
    it("writes buffers, null and unset in order", function () {
        assert.deepEqual(
            decodeFrame(
                writer.buffers([
                    Buffer.from([1, 2]),
                    null,
                    undefined,
                    new Uint8Array([3]),
                    Buffer.alloc(0),
                ]),
            ),
            ["0102", "null", "unset", "03", ""],
        );
    });

    it("reads a Buffer view from its byte offset", function () {
        const source = Buffer.from([9, 1, 2, 9]);
        assert.deepEqual(decodeFrame(writer.buffers([source.subarray(1, 3)])), [
            "0102",
        ]);
    });

    it("writes a Uint8Array view from another realm", function () {
        const value = runInNewContext(
            "new Uint8Array([9, 1, 2, 9]).subarray(1, 3)",
        );
        assert.deepEqual(decodeFrame(writer.buffers([value])), ["0102"]);
    });

    it("rejects values that are not encoded", function () {
        for (const bad of [
            42,
            "x",
            {},
            [1],
            new Int8Array(2),
            new Uint8ClampedArray(2),
            new Uint16Array(2),
            new DataView(new ArrayBuffer(2)),
            runInNewContext("new Uint16Array(2)"),
        ]) {
            assert.throws(
                () => writer.buffers([bad]),
                TypeError,
                /Expected a Buffer, null or undefined/,
            );
        }
    });

    it("rejects more than 65,535 values", function () {
        assert.throws(
            () => writer.buffers(Array(65536).fill(null)),
            /Too many values/,
        );
    });
});

describe("FrameWriter", function () {
    const encoder = new Encoder(4, {});
    const int = { code: types.dataTypes.int };
    const text = { code: types.dataTypes.text };

    it("rejects a nested frame on the same writer", function () {
        const writer = new FrameWriter();
        const nesting = {
            encode: () => {
                writer.params([int], [1], encoder);
                return null;
            },
        };
        assert.throws(
            () => writer.params([null], [1], nesting),
            /already writing a frame/,
        );
        assert.deepEqual(decodeFrame(writer.params([int], [3], encoder)), [
            "00000003",
        ]);
    });

    it("works again after the encoder throws", function () {
        const writer = new FrameWriter();
        assert.throws(() => writer.params([int], ["x"], encoder));
        assert.deepEqual(decodeFrame(writer.params([int], [4], encoder)), [
            "00000004",
        ]);
    });

    it("drops a large buffer after the frame, and keeps the frame", function () {
        const writer = new FrameWriter();
        const big = writer.params([text], ["x".repeat(100000)], encoder);
        const small = writer.params([int], [5], encoder);
        assert.strictEqual(small.buffer.byteLength, 4096);
        assert.lengthOf(decodeFrame(big)[0], 200000);
    });

    it("keeps the frames of two writers apart", function () {
        const a = new FrameWriter().params([int], [1], encoder);
        const b = new FrameWriter().params([int], [2], encoder);
        assert.deepEqual(decodeFrame(a), ["00000001"]);
        assert.deepEqual(decodeFrame(b), ["00000002"]);
    });
});
