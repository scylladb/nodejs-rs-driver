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
});
