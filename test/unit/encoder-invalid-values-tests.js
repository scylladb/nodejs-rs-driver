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

        it("still writes an object with get and length, like a Tuple", function () {
            const items = [1, "x"];
            const tupleLike = { get: (i) => items[i], length: 2 };
            assert.strictEqual(
                encoder.encode(tupleLike, tuple).toString("hex"),
                encoder.encode(new types.Tuple(1, "x"), tuple).toString("hex"),
            );
        });

        it("still writes a Tuple", function () {
            assert.strictEqual(
                encoder.encode(new types.Tuple(1, "x"), tuple).toString("hex"),
                "00000004" + "00000001" + "00000001" + "78",
            );
        });
    });

    describe("UDT values that are not objects", function () {
        const encoder = new Encoder(4, {});
        const udt = t(dataTypes.udt, {
            name: "u",
            fields: [{ name: "a", type: int }],
        });

        // Before, each of these gave a UDT with every field null.
        for (const [name, value] of [
            ["a number", 5],
            ["a string", "ab"],
            ["a JSON string", '{"a":1}'],
            ["an array", [1]],
            ["a Map", new Map([["a", 1]])],
        ]) {
            it(`rejects ${name}`, function () {
                assertRejects(
                    encoder,
                    value,
                    udt,
                    "Not a valid udt value, expected Object obtained",
                );
            });
        }

        it("still writes a plain object and a class instance", function () {
            class A {
                constructor() {
                    this.a = 1;
                }
            }
            for (const value of [{ a: 1 }, new A()]) {
                assert.strictEqual(
                    encoder.encode(value, udt).toString("hex"),
                    "00000004" + "00000001",
                );
            }
        });
    });
});
