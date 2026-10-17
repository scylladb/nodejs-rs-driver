"use strict";

const assert = require("assert");
const { VIntCoding } = require("../../lib/utils");

describe("VIntCoding.uvintWrite", function () {
    // The edges of each vint size, with the size: 1, 2, 3, 4 and 5 bytes.
    const cases = [
        [0, 1],
        [0x7f, 1],
        [0x80, 2],
        [0x3fff, 2],
        [0x4000, 3],
        [0x1fffff, 3],
        [0x200000, 4],
        [0xfffffff, 4],
        [0x10000000, 5],
        [0x7fffffff, 5],
    ];

    it("writes the bytes of uvintPack at an offset, and returns their number", function () {
        for (const [value, size] of cases) {
            const packed = VIntCoding.uvintPack(value);
            assert.strictEqual(packed.length, size, String(value));
            assert.strictEqual(VIntCoding.uvintSize(value), size);
            const actual = Buffer.alloc(16, 0xaa);
            assert.strictEqual(VIntCoding.uvintWrite(value, actual, 5), size);
            // The bytes around the vint do not change.
            const expected = Buffer.alloc(16, 0xaa);
            packed.copy(expected, 5);
            assert.deepStrictEqual(actual, expected, String(value));
            const unpacked = VIntCoding.uvintUnpack(actual.subarray(5));
            assert.deepStrictEqual(unpacked, [value, size]);
        }
    });

    it("writes the largest value in 5 bytes", function () {
        const actual = Buffer.alloc(5);
        assert.strictEqual(VIntCoding.uvintSize(0xffffffff), 5);
        assert.strictEqual(VIntCoding.uvintWrite(0xffffffff, actual, 0), 5);
        assert.strictEqual(actual.toString("hex"), "f0ffffffff");
    });
});
