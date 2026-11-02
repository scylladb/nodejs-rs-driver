"use strict";

const { assert } = require("chai");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");

const { dataTypes, Integer, BigDecimal } = types;
const int = { code: dataTypes.int };
const varint = { code: dataTypes.varint };
const decimal = { code: dataTypes.decimal };
const hex = (h) => Buffer.from(h, "hex");

// In CQL, a value of 0 bytes is the empty value. For varint and decimal, it is not a number:
// ScyllaDB and Cassandra keep it apart from 0, for example as a clustering key.
describe("Decoding of varint and decimal values", function () {
    const bigIntEncoder = new Encoder(4, {
        encoding: { useBigIntAsVarint: true },
    });
    const integerEncoder = new Encoder(4, {
        encoding: { useBigIntAsVarint: false },
    });

    describe("the empty value", function () {
        it("decodes an empty varint value as null", function () {
            assert.isNull(bigIntEncoder.decode(hex(""), varint));
            assert.isNull(integerEncoder.decode(hex(""), varint));
        });

        it("decodes an empty decimal value as null", function () {
            assert.isNull(bigIntEncoder.decode(hex(""), decimal));
        });

        it("decodes the empty cells of a row as null", function () {
            // One row: the int 1, then an empty varint and an empty decimal.
            const page = hex("00000004" + "00000001" + "00000000" + "00000000");
            const [row] = bigIntEncoder.decodeRows(
                page,
                1,
                ["i", "v", "d"],
                [int, varint, decimal],
            );
            assert.strictEqual(row.i, 1);
            assert.isNull(row.v);
            assert.isNull(row.d);
        });
    });

    describe("malformed decimal values", function () {
        it("rejects a value that is too short for the scale", function () {
            for (const bytes of ["00", "0000", "000002"]) {
                const message = `The scale of a decimal value needs 4 bytes, got ${bytes.length / 2}`;
                assert.throws(
                    () => BigDecimal.fromBuffer(hex(bytes)),
                    TypeError,
                    message,
                );
                assert.throws(
                    () => bigIntEncoder.decode(hex(bytes), decimal),
                    TypeError,
                    message,
                );
            }
            // decode gives null for an empty value. Only a direct call gets the error.
            assert.throws(
                () => BigDecimal.fromBuffer(hex("")),
                TypeError,
                "The scale of a decimal value needs 4 bytes, got 0",
            );
        });
    });

    // A leading byte is redundant when it only repeats the sign of the next byte:
    // 0x00 before a byte with the top bit clear, or 0xff before a byte with the top bit set.
    describe("redundant sign bytes", function () {
        // The bytes, the same bytes without the redundant ones, and the value.
        const cases = [
            ["00", "00", 0n],
            ["0000", "00", 0n],
            ["01", "01", 1n],
            ["0001", "01", 1n],
            ["7f", "7f", 127n],
            ["007f", "7f", 127n],
            ["80", "80", -128n],
            ["0080", "0080", 128n],
            ["ff", "ff", -1n],
            ["00ff", "00ff", 255n],
            ["ffff", "ff", -1n],
            ["ffffff", "ff", -1n],
            ["ff80", "80", -128n],
            ["ff7f", "ff7f", -129n],
            ["ffff7f", "ff7f", -129n],
        ];

        it("decodes varint values as BigInt", function () {
            for (const [bytes, , value] of cases) {
                assert.strictEqual(
                    bigIntEncoder.decode(hex(bytes), varint),
                    value,
                    bytes,
                );
            }
        });

        it("decodes varint values as Integer", function () {
            for (const [bytes, normalized, value] of cases) {
                const decoded = integerEncoder.decode(hex(bytes), varint);
                assert.instanceOf(decoded, Integer);
                assert.strictEqual(decoded.toString(), value.toString(), bytes);
                assert.strictEqual(
                    Integer.toBuffer(decoded).toString("hex"),
                    normalized,
                    bytes,
                );
            }
        });

        it("decodes the unscaled values of decimal values", function () {
            for (const [bytes, normalized] of cases) {
                // The scale 1, then the unscaled value.
                const decoded = bigIntEncoder.decode(
                    hex("00000001" + bytes),
                    decimal,
                );
                assert.instanceOf(decoded, BigDecimal);
                assert.strictEqual(
                    BigDecimal.toBuffer(decoded).toString("hex"),
                    "00000001" + normalized,
                    bytes,
                );
            }
        });
    });
});
