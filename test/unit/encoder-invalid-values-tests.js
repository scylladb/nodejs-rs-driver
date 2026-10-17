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
    describe("collection items that are encoded as null", function () {
        const encoder = new Encoder(4, {
            encoding: { set: Set, map: Map },
        });
        const collection = "A collection can't contain null or unset values";

        it("rejects an empty list in a list", function () {
            assertRejects(
                encoder,
                [[1], []],
                t(dataTypes.list, t(dataTypes.list, int)),
                collection,
            );
        });

        it("rejects an empty set in a set", function () {
            assertRejects(
                encoder,
                [[]],
                t(dataTypes.set, t(dataTypes.set, int)),
                collection,
            );
        });

        it("rejects an empty array in a list without item type", function () {
            assertRejects(encoder, [[]], t(dataTypes.list), collection);
        });

        it("rejects an empty list as a map key", function () {
            assertRejects(
                encoder,
                new Map([[[], 1]]),
                t(dataTypes.map, [t(dataTypes.list, int), int]),
                "A map can't contain null or unset keys",
            );
        });

        it("still writes an empty list as a map value with length 0", function () {
            assert.strictEqual(
                encoder
                    .encode(
                        { a: [] },
                        t(dataTypes.map, [text, t(dataTypes.list, int)]),
                    )
                    .toString("hex"),
                "00000001" + "00000001" + "61" + "00000000",
            );
        });

        for (const [name, element] of [
            ["null", null],
            ["undefined", undefined],
            ["unset", types.unset],
        ]) {
            it(`rejects an element that is ${name} in a vector`, function () {
                assertRejects(
                    encoder,
                    new Vector([1, element], "int"),
                    vector(int, 2),
                    "A vector can't contain null or unset values",
                );
            });
        }

        it("rejects an empty list as a vector element", function () {
            assertRejects(
                encoder,
                new Vector([[1], []]),
                vector(t(dataTypes.list, int), 2),
                "A vector can't contain null or unset values",
            );
        });
    });
});
