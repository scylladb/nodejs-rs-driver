"use strict";

const assert = require("assert");
const { Integer, BigDecimal } = require("../../lib/types");

/**
 * Gets the bytes of a CQL varint, with BigInt: the shortest big-endian
 * two's complement of the value. It is the reference for Integer.toBuffer.
 * @param {bigint} n
 * @returns {Buffer}
 */
function varintBytes(n) {
    let length = 1;
    while (
        n < -(1n << BigInt(8 * length - 1)) ||
        n >= 1n << BigInt(8 * length - 1)
    ) {
        length++;
    }
    const hex = BigInt.asUintN(8 * length, n).toString(16);
    return Buffer.from(hex.padStart(2 * length, "0"), "hex");
}

/**
 * Gives random 32-bit unsigned integers, from a seed (mulberry32).
 * The same seed gives the same values, so that a failure can be repeated.
 */
function randomUint32(seed) {
    return function () {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return (t ^ (t >>> 14)) >>> 0;
    };
}

/**
 * Gets values with all byte lengths up to 40: the edges near each power of 2,
 * and random values with a random number of bits.
 * @returns {bigint[]}
 */
function testValues() {
    const values = [0n];
    for (let k = 0n; k <= 320n; k++) {
        const p = 1n << k;
        values.push(p - 1n, p, p + 1n, -p - 1n, -p, -p + 1n);
    }
    const next = randomUint32(644);
    for (let i = 0; i < 10000; i++) {
        let n = 0n;
        for (let words = 1 + (next() % 10); words > 0; words--) {
            n = (n << 32n) | BigInt(next());
        }
        n = BigInt.asUintN(1 + (next() % 320), n);
        values.push(next() % 2 === 0 ? n : -n);
    }
    return values;
}

describe("Integer.toBuffer", function () {
    it("gives the shortest two's complement of the value", function () {
        for (const n of testValues()) {
            const bytes = Integer.toBuffer(Integer.fromString(n.toString()));
            assert.strictEqual(
                bytes.toString("hex"),
                varintBytes(n).toString("hex"),
                n.toString(),
            );
        }
    });
});

describe("BigDecimal.toBuffer", function () {
    it("gives the scale and the bytes of the unscaled value", function () {
        const next = randomUint32(655);
        for (const n of testValues()) {
            const scale = next() | 0;
            const value = new BigDecimal(
                Integer.fromString(n.toString()),
                scale,
            );
            const expected = Buffer.alloc(4);
            expected.writeInt32BE(scale, 0);
            assert.strictEqual(
                BigDecimal.toBuffer(value).toString("hex"),
                expected.toString("hex") + varintBytes(n).toString("hex"),
                `${n} with scale ${scale}`,
            );
        }
    });
});
