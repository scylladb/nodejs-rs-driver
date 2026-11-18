"use strict";

const { assert } = require("chai");
const sinon = require("sinon");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");
const { GrowableBuffer } = require("../../lib/growable-buffer");
const { VIntCoding } = require("../../lib/utils");

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

    it("grows the buffer by the exact byte length of a long string", function () {
        const encoder = new Encoder(4, {});
        for (const code of [dataTypes.ascii, dataTypes.text]) {
            const out = new GrowableBuffer(4096);
            const end = encoder.encodeInto(out, 0, "a".repeat(30000), t(code));
            assert.strictEqual(end, 30004);
            // For text, 3 bytes for each character would grow the buffer to 128 KiB.
            assert.strictEqual(out.buffer.length, 32768, String(code));
        }
    });

    it("grows the buffer by the exact byte length when the upper bound is more than 16 KiB", function () {
        const encoder = new Encoder(4, {});
        // The example in the doc comment of MAX_STRING_GROWTH_BY_UPPER_BOUND.
        const out = new GrowableBuffer(4096);
        const end = encoder.encodeInto(
            out,
            0,
            "a".repeat(10000),
            t(dataTypes.text),
        );
        assert.strictEqual(end, 10004);
        // The upper bound, 30,000 bytes, would grow the buffer to 32 KiB.
        assert.strictEqual(out.buffer.length, 16384);
    });

    it("grows the buffer by the exact byte length when the upper bound ends after 64 KiB", function () {
        const encoder = new Encoder(4, {});
        // The cell of the 12th of 13 texts of 5,000 characters in one frame.
        const out = new GrowableBuffer(65536);
        const end = encoder.encodeInto(
            out,
            55046,
            "a".repeat(5000),
            t(dataTypes.text),
        );
        assert.strictEqual(end, 60050);
        // The upper bound, 15,000 bytes, would grow the buffer to 128 KiB.
        assert.strictEqual(out.buffer.length, 65536);
    });

    it("grows the buffer past 64 KiB when the bytes of a string need it", function () {
        const encoder = new Encoder(4, {});
        const out = new GrowableBuffer(65536);
        const value = "a".repeat(5000);
        const end = encoder.encodeInto(out, 62000, value, t(dataTypes.text));
        assert.strictEqual(end, 67004);
        assert.strictEqual(out.buffer.length, 131072);
        assert.strictEqual(out.buffer.readInt32BE(62000), 5000);
        assert.strictEqual(out.buffer.toString("utf8", 62004, end), value);
    });

    it("makes room for the length of a value of zero bytes at the end of the buffer", function () {
        const encoder = new Encoder(4, {});
        const tupleType = t(dataTypes.tuple, [t(dataTypes.int)]);
        // A tuple of zero items has zero bytes, and its encoder does not call ensure.
        // A Tuple has at least one item, but the encoder takes any object with get() and length.
        const empty = { length: 0, get: () => undefined };
        const cases = [
            // The cell of the tuple: only its length.
            [tupleType, empty, "00000000"],
            // A list of one tuple: the length of the list, the count, and the length of the tuple.
            [t(dataTypes.list, tupleType), [empty], "000000080000000100000000"],
            // A vector of one tuple: the length of the vector, and the vint of the tuple.
            // In a buffer of 12 bytes, the vint starts at the end of the buffer.
            [
                {
                    code: dataTypes.custom,
                    customTypeName: "vector",
                    info: [tupleType, 1],
                },
                new types.Vector([empty], "tuple<int>"),
                "0000000100",
                12,
            ],
        ];
        for (const [type, value, hex, size = 8] of cases) {
            const out = new GrowableBuffer(size);
            const end = encoder.encodeInto(out, 8, value, type);
            assert.isAtLeast(out.buffer.length, end, hex);
            assert.strictEqual(out.buffer.toString("hex", 8, end), hex);
        }
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
            // The length at 10-13, the count at 14-17, the item with its length at 18-61.
            [t(dataTypes.list, t(dataTypes.blob)), [bytes], 10],
            // The length at 10-13, the count at 14-17, the key with its length at 18-51,
            // and the value with its length at 52-59.
            [
                t(dataTypes.map, [t(dataTypes.ascii), t(dataTypes.int)]),
                { ["a".repeat(30)]: 1 },
                10,
            ],
            // The length at 12-15, the element with its vint at 16-56.
            [
                {
                    code: dataTypes.custom,
                    customTypeName: "vector",
                    info: [t(dataTypes.blob), 1],
                },
                new types.Vector([bytes], "blob"),
                12,
            ],
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

describe("Encoder.encodeInto with a vector of a type with a variable size", function () {
    const vectorType = (code, dimension) => ({
        code: dataTypes.custom,
        customTypeName: "vector",
        info: [{ code }, dimension],
    });

    it("writes the length of each element as an unsigned vint, before the bytes", function () {
        const encoder = new Encoder(4, {});
        // Byte lengths at the edges of the vint sizes: 1, 2, 3 and 4 bytes.
        const elements = [
            "",
            "zażółć",
            "a".repeat(127),
            "ł".repeat(64),
            "a".repeat(16383),
            "a".repeat(16384),
            "a".repeat(2097151),
            "a".repeat(2097152),
        ];
        const parts = [];
        for (const element of elements) {
            const bytes = Buffer.from(element, "utf8");
            parts.push(VIntCoding.uvintPack(bytes.length), bytes);
        }
        const expected = Buffer.concat(parts);
        const cell = cellFromEncodeInto(
            encoder,
            new types.Vector(elements, "text"),
            vectorType(dataTypes.text, elements.length),
        );
        assert.strictEqual(cell.readInt32BE(0), expected.length);
        assert.isTrue(cell.subarray(4).equals(expected));
    });

    it("grows the buffer only for bytes that it writes", function () {
        const encoder = new Encoder(4, {});
        // The cell has 4 bytes of length, a vint of 2 bytes, and 1,000 bytes.
        // The vint needs more than 1 byte. Thus, the bytes move by 1 byte.
        const element = Buffer.alloc(1000, 7);
        const cases = [
            // The cell ends at 64 KiB. The buffer does not grow.
            [64530, 65536],
            // The cell ends 1 byte after 64 KiB. The move grows the buffer,
            // and the bytes and the vint go into the new buffer.
            [64531, 131072],
        ];
        for (const [offset, size] of cases) {
            const out = new GrowableBuffer(65536);
            const end = encoder.encodeInto(
                out,
                offset,
                new types.Vector([element], "blob"),
                vectorType(dataTypes.blob, 1),
            );
            const at = `offset ${offset}`;
            assert.strictEqual(end, offset + 1006, at);
            assert.strictEqual(out.buffer.length, size, at);
            assert.strictEqual(out.buffer.readInt32BE(offset), 1002, at);
            assert.strictEqual(
                out.buffer.toString("hex", offset + 4, offset + 6),
                VIntCoding.uvintPack(1000).toString("hex"),
                at,
            );
            assert.isTrue(
                out.buffer.subarray(offset + 6, end).equals(element),
                at,
            );
        }
    });

    it("does not allocate a Buffer for an element", function () {
        const cases = [
            [
                new Encoder(4, {}),
                "text",
                dataTypes.text,
                Array.from({ length: 128 }, () => "a".repeat(1000)),
            ],
            [
                new Encoder(4, { encoding: { useBigIntAsVarint: true } }),
                "varint",
                dataTypes.varint,
                Array.from({ length: 8192 }, () => 0n),
            ],
        ];
        for (const [encoder, subtype, code, elements] of cases) {
            const vector = new types.Vector(elements, subtype);
            const type = vectorType(code, elements.length);
            // The buffer has room for the whole vector. Thus, it does not grow.
            const out = new GrowableBuffer(1 << 20);
            const spies = [
                "allocUnsafe",
                "allocUnsafeSlow",
                "alloc",
                "from",
            ].map((name) => sinon.spy(Buffer, name));
            try {
                encoder.encodeInto(out, 0, vector, type);
            } finally {
                spies.forEach((spy) => spy.restore());
            }
            for (const spy of spies) {
                assert.strictEqual(spy.callCount, 0, `${subtype}: ${spy}`);
            }
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
