"use strict";

const { assert } = require("chai");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");

const bigint = { code: types.dataTypes.bigint };
const counter = { code: types.dataTypes.counter };

// A bigint is the two's complement of the value, in big-endian order, in 8 bytes.
// A counter has the same format.
describe("Encoder decoding bigint as BigInt", function () {
    const encoder = new Encoder(4, { encoding: { useBigIntAsLong: true } });
    const longEncoder = new Encoder(4, {
        encoding: { useBigIntAsLong: false },
    });
    const decode = (bytes) => encoder.decode(bytes, bigint);

    // The correct values of random bytes, computed without the decoder under test:
    // - fromHex reads the bytes as one hexadecimal number, then applies the sign.
    //   This is the definition of the bigint format.
    // - fromLong uses the decoder of Long mode, which shares no code with
    //   the decoder under test.
    const fromHex = (bytes) =>
        BigInt.asIntN(64, BigInt("0x" + bytes.toString("hex")));
    const fromLong = (bytes) =>
        BigInt(longEncoder.decode(bytes, bigint).toString());

    // The same bytes for each run.
    let seed = 99;
    const randomByte = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed >>> 24;
    };

    // The decoder can read the value in two halves of 32 bits.
    // Thus, the cases include the limits of each half.
    it("decodes values at the limits of each half", function () {
        const cases = [
            ["0000000000000000", 0n],
            ["0000000000000001", 1n],
            ["ffffffffffffffff", -1n],
            ["000000007fffffff", 2n ** 31n - 1n],
            ["0000000080000000", 2n ** 31n],
            ["00000000ffffffff", 2n ** 32n - 1n],
            ["0000000100000000", 2n ** 32n],
            ["ffffffff80000000", -(2n ** 31n)],
            ["ffffffff7fffffff", -(2n ** 31n) - 1n],
            ["ffffffff00000001", -(2n ** 32n) + 1n],
            ["ffffffff00000000", -(2n ** 32n)],
            ["7fffffffffffffff", 2n ** 63n - 1n],
            ["8000000000000000", -(2n ** 63n)],
            ["8000000000000001", -(2n ** 63n) + 1n],
            ["0123456789abcdef", 0x0123456789abcdefn],
            ["fedcba9876543210", 0xfedcba9876543210n - 2n ** 64n],
        ];
        for (const [hex, expected] of cases) {
            assert.strictEqual(decode(Buffer.from(hex, "hex")), expected, hex);
        }
    });

    it("decodes counter values", function () {
        const cases = [
            ["0000000000000001", 1n],
            ["ffffffffffffffff", -1n],
            ["7fffffffffffffff", 2n ** 63n - 1n],
            ["8000000000000000", -(2n ** 63n)],
        ];
        for (const [hex, expected] of cases) {
            assert.strictEqual(
                encoder.decode(Buffer.from(hex, "hex"), counter),
                expected,
                hex,
            );
        }
    });

    it("decodes a value that is a part of a larger buffer", function () {
        const buffer = Buffer.from("aa" + "ffffffff00000001" + "bb", "hex");
        assert.strictEqual(decode(buffer.subarray(1, 9)), -(2n ** 32n) + 1n);
    });

    it("decodes random values", function () {
        // null: a random first byte
        for (const first of [0x00, 0x7f, 0x80, 0xff, null, null, null]) {
            for (let n = 0; n < 100; n++) {
                const bytes = Buffer.alloc(8);
                for (let i = 0; i < 8; i++) {
                    bytes[i] = randomByte();
                }
                if (first !== null) {
                    bytes[0] = first;
                }
                const hex = bytes.toString("hex");
                const value = decode(bytes);
                assert.strictEqual(value, fromHex(bytes), hex);
                assert.strictEqual(value, fromLong(bytes), hex);
            }
        }
    });

    it("rejects a value of fewer than 8 bytes", function () {
        for (const hex of ["00", "000000", "00000000", "00000000000000"]) {
            assert.throws(() => decode(Buffer.from(hex, "hex")), RangeError);
        }
    });
});
