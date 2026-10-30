"use strict";

const { assert } = require("chai");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");

const varint = { code: types.dataTypes.varint };

// A varint is the two's complement of the value, in big-endian order, with any number of bytes.
describe("Encoder decoding varint as BigInt", function () {
    const encoder = new Encoder(4, { encoding: { useBigIntAsVarint: true } });
    const integerEncoder = new Encoder(4, {
        encoding: { useBigIntAsVarint: false },
    });
    const decode = (bytes) => encoder.decode(bytes, varint);

    // The correct values of random bytes, computed without the decoder under test:
    // - fromHex reads the bytes as one hexadecimal number, then applies the sign.
    //   This is the definition of the varint format.
    // - fromInteger uses the decoder of Integer mode, which shares no code with
    //   the decoder under test.
    const fromHex = (bytes) =>
        BigInt.asIntN(bytes.length * 8, BigInt("0x" + bytes.toString("hex")));
    const fromInteger = (bytes) =>
        BigInt(integerEncoder.decode(bytes, varint).toString());

    // The same bytes for each run.
    let seed = 99;
    const randomByte = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed >>> 24;
    };

    it("decodes values at the limits of each byte count", function () {
        const cases = [
            ["00", 0n],
            ["01", 1n],
            ["7f", 127n],
            ["80", -128n],
            ["ff", -1n],
            ["0080", 128n],
            ["00ff", 255n],
            ["ff7f", -129n],
            ["8000", -32768n],
            ["7fffff", 8388607n],
            ["800000", -8388608n],
            ["7fffffff", 2147483647n],
            ["80000000", -2147483648n],
            ["00ffffffff", 4294967295n],
            ["ff00000000", -4294967296n],
            ["7fffffffffff", 2n ** 47n - 1n],
            ["800000000000", -(2n ** 47n)],
            ["7fffffffffffff", 2n ** 55n - 1n],
            ["80000000000000", -(2n ** 55n)],
            ["7fffffffffffffff", 2n ** 63n - 1n],
            ["8000000000000000", -(2n ** 63n)],
            ["010000000000000000", 2n ** 64n],
            ["ff0000000000000000", -(2n ** 64n)],
            ["00" + "ff".repeat(16), 2n ** 128n - 1n],
            ["ff" + "00".repeat(16), -(2n ** 128n)],
        ];
        for (const [hex, expected] of cases) {
            assert.strictEqual(decode(Buffer.from(hex, "hex")), expected, hex);
        }
    });

    it("decodes values with more sign bytes than needed", function () {
        assert.strictEqual(decode(Buffer.from("0000000001", "hex")), 1n);
        assert.strictEqual(decode(Buffer.from("ffffffffff", "hex")), -1n);
        assert.strictEqual(decode(Buffer.from("ffffff80", "hex")), -128n);
    });

    // The empty value is not a number. decode gives null for it before it calls the decoder.
    it("decodes an empty buffer as null, like decode", function () {
        assert.isNull(encoder.decodeVarint(Buffer.alloc(0)));
        assert.isNull(decode(Buffer.alloc(0)));
    });

    it("decodes a value that is a part of a larger buffer", function () {
        const buffer = Buffer.from("aa" + "ffffffff00000001" + "bb", "hex");
        assert.strictEqual(decode(buffer.subarray(1, 9)), -(2n ** 32n) + 1n);
    });

    it("decodes random values of 1 to 40 bytes", function () {
        for (let length = 1; length <= 40; length++) {
            // null: a random first byte
            for (const first of [0x00, 0x7f, 0x80, 0xff, null, null, null]) {
                const bytes = Buffer.alloc(length);
                for (let i = 0; i < length; i++) {
                    bytes[i] = randomByte();
                }
                if (first !== null) {
                    bytes[0] = first;
                }
                const hex = bytes.toString("hex");
                const value = decode(bytes);
                assert.strictEqual(value, fromHex(bytes), hex);
                assert.strictEqual(value, fromInteger(bytes), hex);
            }
        }
    });
});
