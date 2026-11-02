"use strict";

const { assert } = require("chai");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");
const Vector = require("../../lib/types/vector");

const { dataTypes } = types;
const int = { code: dataTypes.int };

describe("Encoder with a vector element type given as a hint", function () {
    const encoder = new Encoder(4, {});
    const vectorOf = (subtype) => ({
        code: dataTypes.custom,
        customTypeName: "vector",
        info: [subtype, 2],
    });
    const value = () => new Vector([1, 2], "int");
    // Fixed-size int elements, without length prefixes.
    const expected = "00000001" + "00000002";

    it("writes the same bytes for a type, a type name and a type code", function () {
        for (const subtype of [int, "int", dataTypes.int]) {
            assert.strictEqual(
                encoder.encode(value(), vectorOf(subtype)).toString("hex"),
                expected,
                String(subtype),
            );
        }
    });

    it("writes the same bytes for an inner vector element type given by name", function () {
        const nested = (elementType) => ({
            code: dataTypes.custom,
            customTypeName: "vector",
            info: [vectorOf(elementType), 2],
        });
        const nestedValue = () =>
            new Vector([new Vector([1, 2], "int"), new Vector([3, 4], "int")]);
        for (const subtype of [int, "int", dataTypes.int]) {
            assert.strictEqual(
                encoder.encode(nestedValue(), nested(subtype)).toString("hex"),
                "00000001" + "00000002" + "00000003" + "00000004",
                String(subtype),
            );
        }
    });

    it("rejects an unknown type name", function () {
        assert.throws(
            () => encoder.encode(value(), vectorOf("no_such_type")),
            TypeError,
        );
    });
});

describe("Encoder with missing type hints", function () {
    const encoder = new Encoder(4, {});
    const listOf = (subtype) => ({ code: dataTypes.list, info: subtype });

    it("still guesses the type for null and undefined hints", function () {
        for (const hint of [null, undefined]) {
            assert.strictEqual(
                encoder.encode(1, hint).toString("hex"),
                "3ff0000000000000",
            );
            assert.strictEqual(
                encoder.encode([1], listOf(hint)).toString("hex"),
                "00000001" + "00000008" + "3ff0000000000000",
            );
        }
    });
});
