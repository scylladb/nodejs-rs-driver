"use strict";

const assert = require("assert");
const { VIntCoding } = require("../../lib/utils");

describe("VIntCoding.writeVInt", function () {
    const values = [
        0n,
        1n,
        -1n,
        63n,
        -64n,
        64n,
        1n << 31n,
        -(1n << 31n),
        (1n << 63n) - 1n,
        -(1n << 63n),
    ];

    it("writes at an offset the same bytes as at the start", function () {
        for (const value of values) {
            const atStart = Buffer.alloc(9);
            const length = VIntCoding.writeVInt(value, atStart);
            const actual = Buffer.alloc(16, 0xaa);
            assert.strictEqual(VIntCoding.writeVInt(value, actual, 5), length);
            // The bytes around the vint do not change.
            const expected = Buffer.alloc(16, 0xaa);
            atStart.copy(expected, 5, 0, length);
            assert.deepStrictEqual(actual, expected, value.toString());
        }
    });
});
