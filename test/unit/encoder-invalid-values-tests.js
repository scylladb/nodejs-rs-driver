"use strict";

const { assert } = require("chai");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");
const Vector = require("../../lib/types/vector");

const { dataTypes } = types;
const t = (code, info) => ({ code, info });
const int = t(dataTypes.int);
const text = t(dataTypes.text);
const vector = (subtype, dimension) => ({
    code: dataTypes.custom,
    customTypeName: "vector",
    info: [subtype, dimension],
});

/** Checks that `encode` throws a TypeError with the message. */
function assertRejects(encoder, value, type, message) {
    assert.throws(() => encoder.encode(value, type), TypeError, message);
}

describe("Encoder with values that it cannot encode", function () {
    describe("null and unset vector elements", function () {
        const encoder = new Encoder(4, {});

        for (const [name, element] of [
            ["null", null],
            ["undefined", undefined],
            ["unset", types.unset],
        ]) {
            it(`rejects an element that is ${name}`, function () {
                assertRejects(
                    encoder,
                    new Vector([1, element], "int"),
                    vector(int, 2),
                    "A vector can't contain null or unset values",
                );
            });
        }
    });

    describe("tuple values that are not tuples", function () {
        const encoder = new Encoder(4, {});
        const tuple = t(dataTypes.tuple, [int, text]);

        for (const [name, value] of [
            ["an array", [1, "x"]],
            ["a number", 5],
            ["a plain object", { get: 1, length: 2 }],
        ]) {
            it(`rejects ${name}`, function () {
                assertRejects(
                    encoder,
                    value,
                    tuple,
                    "Not a valid tuple, expected Tuple obtained",
                );
            });
        }

        it("still writes a Tuple", function () {
            assert.strictEqual(
                encoder.encode(new types.Tuple(1, "x"), tuple).toString("hex"),
                "00000004" + "00000001" + "00000001" + "78",
            );
        });
    });

    describe("types without their type information", function () {
        const encoder = new Encoder(4, {});

        it("rejects a UDT type without fields", function () {
            for (const info of [undefined, { name: "u" }]) {
                assertRejects(
                    encoder,
                    { a: 1 },
                    t(dataTypes.udt, info),
                    "Type information not valid, a UDT type needs its fields",
                );
            }
        });

        it("rejects a UDT type with a field without type", function () {
            // Without this check, the Encoder guessed the field type: double for 1.
            assertRejects(
                encoder,
                { a: 1, b: 2 },
                t(dataTypes.udt, {
                    name: "u",
                    fields: [{ name: "a", type: int }, { name: "b" }],
                }),
                "Type information not valid, a UDT type needs the type of each field",
            );
        });

        it("rejects a UDT type with a hole or null in its fields", function () {
            const sparse = [];
            sparse[1] = { name: "b", type: int };
            for (const fields of [sparse, [null]]) {
                assertRejects(
                    encoder,
                    { b: 1 },
                    t(dataTypes.udt, { name: "u", fields }),
                    "Type information not valid, a UDT type needs the type of each field",
                );
            }
        });

        it("rejects a UDT field without a valid, unique name", function () {
            // Without this check, the Encoder read value[name] with any name:
            // a missing name read value["undefined"], and a repeated name wrote a field twice.
            for (const fields of [
                [{ type: int }],
                [{ name: null, type: int }],
                [{ name: 1, type: int }],
                [{ name: ["a"], type: int }],
                [{ name: "", type: int }],
                [
                    { name: "a", type: int },
                    { name: "a", type: int },
                ],
            ]) {
                assertRejects(
                    encoder,
                    { a: 1 },
                    t(dataTypes.udt, { name: "u", fields }),
                    "Type information not valid, a UDT type needs a different, non-empty name for each field",
                );
            }
        });

        it("still accepts a UDT field type given by name", function () {
            assert.strictEqual(
                encoder
                    .encode(
                        { a: 1 },
                        t(dataTypes.udt, {
                            name: "u",
                            fields: [{ name: "a", type: "int" }],
                        }),
                    )
                    .toString("hex"),
                "00000004" + "00000001",
            );
        });

        it("rejects a tuple type without item types", function () {
            // An empty type list encoded every tuple as no bytes.
            // A sparse array has holes, which some and for...of skip.
            for (const info of [
                undefined,
                [],
                [int, undefined],
                new Array(1),
                [int, , int], // eslint-disable-line no-sparse-arrays
            ]) {
                assertRejects(
                    encoder,
                    new types.Tuple(1, 2),
                    t(dataTypes.tuple, info),
                    "Type information not valid, a tuple type needs the types of its items",
                );
            }
        });

        it("rejects an inner vector type without element type", function () {
            // The size lookup reads the element type of the inner vector, before encodeVector checks it.
            assertRejects(
                encoder,
                new Vector([
                    new Vector([1, 2], "int"),
                    new Vector([3, 4], "int"),
                ]),
                vector(vector(undefined, 2), 2),
                "Type information not valid, a vector type needs its element type and a positive dimension",
            );
        });

        it("rejects a vector type without element type and positive dimension", function () {
            for (const info of [
                undefined,
                [int],
                [undefined, 1],
                [int, "1"],
                [int, 0],
                [int, 1.5],
            ]) {
                assertRejects(
                    encoder,
                    new Vector([1], "int"),
                    { code: dataTypes.custom, customTypeName: "vector", info },
                    "Type information not valid, a vector type needs its element type and a positive dimension",
                );
            }
        });
    });
});
