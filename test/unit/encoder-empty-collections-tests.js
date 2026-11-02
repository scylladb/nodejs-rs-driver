"use strict";

const { assert } = require("chai");
const Encoder = require("../../lib/encoder");
const types = require("../../lib/types");
const Vector = require("../../lib/types/vector");

const { dataTypes } = types;
const t = (code, info) => ({ code, info });
const int = t(dataTypes.int);
const text = t(dataTypes.text);
const listOfInt = t(dataTypes.list, int);

// An empty collection is a count of 0, not null.
// For a frozen collection, ScyllaDB stores it as an empty value, which differs from null.
// It is also valid inside other collections, and as a key.
// For a collection that is not frozen, ScyllaDB stores it as null itself.
describe("Encoder with empty collections", function () {
    const encoder = new Encoder(4, { encoding: { set: Set, map: Map } });
    const hex = (value, type) => encoder.encode(value, type).toString("hex");
    const count0 = "00000000";

    it("writes an empty list, set or map as a count of 0", function () {
        assert.strictEqual(hex([], listOfInt), count0);
        assert.strictEqual(hex([], t(dataTypes.set, int)), count0);
        assert.strictEqual(hex(new Set(), t(dataTypes.set, int)), count0);
        assert.strictEqual(hex({}, t(dataTypes.map, [text, int])), count0);
        assert.strictEqual(
            hex(new Map(), t(dataTypes.map, [text, int])),
            count0,
        );
    });

    it("writes an empty array without a type as an empty list", function () {
        assert.strictEqual(hex([], undefined), count0);
    });

    it("writes empty lists inside a list", function () {
        assert.strictEqual(
            hex([[], [1]], t(dataTypes.list, listOfInt)),
            // count 2, then [] and [1], each with its length
            "00000002" +
                "00000004" +
                count0 +
                "0000000c" +
                "00000001" +
                "00000004" +
                "00000001",
        );
    });

    it("writes an empty list as a map key and as a map value", function () {
        assert.strictEqual(
            hex(new Map([[[], 1]]), t(dataTypes.map, [listOfInt, int])),
            "00000001" + "00000004" + count0 + "00000004" + "00000001",
        );
        assert.strictEqual(
            hex({ a: [] }, t(dataTypes.map, [text, listOfInt])),
            "00000001" + "00000001" + "61" + "00000004" + count0,
        );
    });

    it("writes an empty list as a vector element", function () {
        const vectorOfLists = {
            code: dataTypes.custom,
            customTypeName: "vector",
            info: [listOfInt, 2],
        };
        assert.strictEqual(
            hex(new Vector([[], [1]]), vectorOfLists),
            // each element has its length as an unsigned vint
            "04" + count0 + "0c" + "00000001" + "00000004" + "00000001",
        );
    });

    it("still writes null as null", function () {
        assert.strictEqual(encoder.encode(null, listOfInt), null);
    });
});
