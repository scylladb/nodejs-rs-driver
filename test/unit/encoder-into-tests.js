"use strict";

const { assert } = require("chai");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");
const { GrowableBuffer } = require("../../lib/growable-buffer");

const { dataTypes } = types;
const t = (code, info) => ({ code, info });

/** The cell that `encode` gives: `[i32 length][bytes]`, -1 for null, -2 for unset. */
function expectedCell(encoder, value, type) {
    const bytes = encoder.encode(value, type);
    const length = Buffer.alloc(4);
    if (bytes === null) {
        length.writeInt32BE(-1);
        return length;
    }
    if (bytes === undefined) {
        length.writeInt32BE(-2);
        return length;
    }
    length.writeInt32BE(bytes.length);
    return Buffer.concat([length, bytes]);
}

/** Calls `encodeInto` after a 3-byte prefix, and returns the cell it wrote. */
function cellFromEncodeInto(encoder, value, type, size = 64) {
    const out = new GrowableBuffer(size);
    out.buffer.write("abc", 0, "latin1");
    const end = encoder.encodeInto(out, 3, value, type);
    // The bytes before the offset do not change.
    assert.strictEqual(out.buffer.toString("latin1", 0, 3), "abc");
    return Buffer.from(out.buffer.subarray(3, end));
}

/** A GrowableBuffer that records the size of each new buffer. */
class RecordingBuffer extends GrowableBuffer {
    constructor(size) {
        super(size);
        this.sizes = [];
    }

    ensure(used, needed) {
        const before = this.buffer;
        super.ensure(used, needed);
        if (this.buffer !== before) {
            this.sizes.push(this.buffer.length);
        }
    }
}

describe("Encoder.encodeInto", function () {
    const cases = [
        [t(dataTypes.int), 7],
        [t(dataTypes.text), "zażółć"],
        [t(dataTypes.boolean), false],
        [t(dataTypes.list, t(dataTypes.int)), [1, 2]],
        [t(dataTypes.list, t(dataTypes.int)), []],
        [t(dataTypes.map, [t(dataTypes.text), t(dataTypes.int)]), { a: 1 }],
        [t(dataTypes.blob), Buffer.from([1, 2])],
        [t(dataTypes.int), Buffer.from([0, 0, 0, 9])],
        ["int", 5],
        [dataTypes.int, 5],
        [null, "guessed"],
        [t(dataTypes.int), null],
        [t(dataTypes.int), undefined],
        [t(dataTypes.int), types.unset],
    ];

    for (const useUndefinedAsUnset of [false, true]) {
        it(`writes the cell of encode, useUndefinedAsUnset=${useUndefinedAsUnset}`, function () {
            const encoder = new Encoder(4, {
                encoding: { useUndefinedAsUnset },
            });
            for (const [type, value] of cases) {
                assert.deepEqual(
                    cellFromEncodeInto(encoder, value, type),
                    expectedCell(encoder, value, type),
                    `type ${JSON.stringify(type)}, value ${String(value)}`,
                );
            }
        });
    }

    it("grows the buffer, and keeps the bytes before the offset", function () {
        const encoder = new Encoder(4, {});
        const value = "ł".repeat(1000);
        assert.deepEqual(
            cellFromEncodeInto(encoder, value, t(dataTypes.text), 4),
            expectedCell(encoder, value, t(dataTypes.text)),
        );
    });

    it("throws the errors of encode", function () {
        const encoder = new Encoder(4, {});
        const bad = [
            [t(dataTypes.int), "x"],
            [t(dataTypes.text), 5],
            [t(dataTypes.list, t(dataTypes.int)), [1, null]],
            ["no such type", 1],
            [null, Symbol("not guessable")],
        ];
        for (const [type, value] of bad) {
            let expected;
            try {
                encoder.encode(value, type);
            } catch (err) {
                expected = err;
            }
            assert.ok(expected, `encode accepts ${String(value)}`);
            assert.throws(
                () => encoder.encodeInto(new GrowableBuffer(8), 0, value, type),
                expected.constructor,
                expected.message,
            );
        }
    });

    it("grows the buffer once for a cell that ends past it", function () {
        const encoder = new Encoder(4, {});
        const bytes = Buffer.alloc(40, 7);
        // Each cell starts in a buffer of 16 bytes, and ends after byte 32.
        // Thus, its bytes grow the buffer once, to 64.
        // An `ensure` call for a length or a count before the bytes would first grow it to 32.
        const cases = [
            // The length at 14-17, the bytes at 18-57.
            [t(dataTypes.blob), bytes, 14],
            [t(dataTypes.ascii), "a".repeat(40), 14],
        ];
        for (const [type, value, offset] of cases) {
            const out = new RecordingBuffer(16);
            const end = encoder.encodeInto(out, offset, value, type);
            const at = JSON.stringify(type);
            assert.deepEqual(out.sizes, [64], at);
            assert.isTrue(
                out.buffer
                    .subarray(offset, end)
                    .equals(expectedCell(encoder, value, type)),
                at,
            );
        }
    });
});

describe("Encoder.encodeInto with the frozen encodings", function () {
    const { cases, makeEncoders } = require("./fixtures/encoder-cases");
    const frozen = require("./fixtures/encoder-bytes.json");
    const encoders = makeEncoders();

    /**
     * Encodes a frozen case with `encodeInto`, in the format of the frozen encodings.
     * It writes into a buffer of 8 bytes, after a prefix of `offset` bytes.
     * Thus, most cases grow the buffer.
     */
    function encodeIntoCase([label, encoderName, type, value], offset) {
        // A value function that throws is a mistake in the case. Do not catch it.
        const input = value();
        const out = new GrowableBuffer(8);
        const prefix = "abcdefgh".slice(0, offset);
        out.buffer.write(prefix, 0, "latin1");
        let end;
        try {
            end = encoders[encoderName].encodeInto(out, offset, input, type);
        } catch (err) {
            return { error: [err.constructor.name, err.message] };
        }
        // The bytes before the offset do not change.
        assert.strictEqual(
            out.buffer.toString("latin1", 0, offset),
            prefix,
            label,
        );
        const length = out.buffer.readInt32BE(offset);
        if (length === -1) {
            return { hex: null };
        }
        if (length === -2) {
            return { unset: true };
        }
        assert.strictEqual(length, end - offset - 4, label);
        return { hex: out.buffer.toString("hex", offset + 4, end) };
    }

    it("gives the frozen bytes and errors", function () {
        // At offset 3, the length of the cell fits in the buffer.
        // At offsets 5 to 8, it ends past the buffer. The Encoder leaves a hole for it,
        // and writes the bytes after the hole. Thus, each encoder starts past the end of the buffer.
        for (const offset of [3, 5, 6, 7, 8]) {
            for (const c of cases) {
                assert.deepEqual(
                    encodeIntoCase(c, offset),
                    frozen[c[0]],
                    `${c[0]}, offset ${offset}`,
                );
            }
        }
    });
});
