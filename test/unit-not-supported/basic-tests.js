"use strict";
const { assert } = require("chai");

const utils = require("../../lib/utils");

describe("utils", function () {
    describe("#extend()", function () {
        it("should allow null sources", function () {
            const originalObject = {};
            const extended = utils.extend(originalObject, null);
            assert.strictEqual(originalObject, extended);
        });
    });
    describe("#funcCompare()", function () {
        it("should return a compare function valid for Array#sort", function () {
            const values = [
                { id: 1, getValue: () => 100 },
                { id: 2, getValue: () => 3 },
                { id: 3, getValue: () => 1 },
            ];
            values.sort(utils.funcCompare("getValue"));
            assert.strictEqual(values[0].id, 3);
            assert.strictEqual(values[1].id, 2);
            assert.strictEqual(values[2].id, 1);
        });
    });
    describe("#binarySearch()", function () {
        it("should return the key index if found, or the bitwise compliment of the first larger value", function () {
            const compareFunc = function (a, b) {
                if (a > b) {
                    return 1;
                }
                if (a < b) {
                    return -1;
                }
                return 0;
            };
            let val;
            val = utils.binarySearch([0, 1, 2, 3, 4], 2, compareFunc);
            assert.strictEqual(val, 2);
            val = utils.binarySearch(
                ["A", "B", "C", "D", "E"],
                "D",
                compareFunc,
            );
            assert.strictEqual(val, 3);
            val = utils.binarySearch(
                ["A", "B", "C", "D", "Z"],
                "M",
                compareFunc,
            );
            assert.strictEqual(val, ~4);
            val = utils.binarySearch([0, 1, 2, 3, 4], 2.5, compareFunc);
            assert.strictEqual(val, ~3);
        });
    });
    describe("#deepExtend", function () {
        it("should override only the most inner props", function () {
            let value;
            // single values
            value = utils.deepExtend({}, { a: "1" });
            assert.strictEqual(value.a, "1");
            value = utils.deepExtend({ a: "2" }, { a: "1" });
            assert.strictEqual(value.a, "1");
            value = utils.deepExtend({ a: new Date() }, { a: new Date(100) });
            assert.strictEqual(value.a.toString(), new Date(100).toString());
            value = utils.deepExtend({ a: 2 }, { a: 1 });
            assert.strictEqual(value.a, 1);
            // composed 1 level
            value = utils.deepExtend(
                { a: { a1: 1, a2: 2 }, b: 1000 },
                { a: { a2: 15 } },
            );
            assert.strictEqual(value.a.a2, 15);
            assert.strictEqual(value.a.a1, 1);
            assert.strictEqual(value.b, 1000);
            // composed 2 level
            value = utils.deepExtend(
                { a: { a1: 1, a2: { a21: 10, a22: 20 } } },
                { a: { a2: { a21: 11 } }, b: { b1: 100, b2: 200 } },
            );
            assert.strictEqual(value.a.a2.a21, 11);
            assert.strictEqual(value.a.a2.a22, 20);
            assert.strictEqual(value.a.a1, 1);
            assert.strictEqual(value.b.b1, 100);
            assert.strictEqual(value.b.b2, 200);
            // multiple sources
            value = utils.deepExtend(
                { z: 9 },
                { a: { a1: 1, a2: { a21: 10, a22: 20 } } },
                { a: { a2: { a21: 11 } }, b: { b1: 100, b2: 200 } },
            );
            assert.strictEqual(value.a.a2.a21, 11);
            assert.strictEqual(value.a.a2.a22, 20);
            assert.strictEqual(value.a.a1, 1);
            assert.strictEqual(value.b.b1, 100);
            assert.strictEqual(value.b.b2, 200);
            assert.strictEqual(value.z, 9);
            // !source
            value = utils.deepExtend({ z: 3 }, null);
            assert.strictEqual(value.z, 3);
            // undefined
            const o = undefined;
            value = utils.deepExtend({ z: 4 }, o);
            assert.strictEqual(value.z, 4);
        });
    });
});
