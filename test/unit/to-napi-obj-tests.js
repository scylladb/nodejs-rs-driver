"use strict";
const { assert } = require("chai");
const rust = require("../../index");

describe("define_rust_to_js_convertible_object and NamedMap", function () {
    describe("struct variant", function () {
        it("should return a plain object with the correct fields", function () {
            const result = rust.testsNamedMapStruct();
            assert.deepEqual(result, { x: 10, y: 20 });
        });
    });

    describe("enum variants", function () {
        const cases = [
            [0, { kind: 0 }],
            [1, { kind: 1 }],
            [3, { kind: 3, r: 128, g: 0, b: 255 }],
        ];

        cases.forEach(([caseId, expected]) => {
            it(`case ${caseId} should produce ${JSON.stringify(expected)}`, function () {
                assert.deepEqual(rust.testsNamedMapEnum(caseId), expected);
            });
        });
    });

    describe("NamedMap<String, i32, i32>", function () {
        it("should return a plain object keyed by string with numeric values", function () {
            const result = rust.testsNamedMapI32();
            assert.deepEqual(result, { a: 1, b: 2, c: 3 });
        });
    });

    describe("NamedMap with From conversion (tuple -> struct)", function () {
        it("should convert values via From and return nested objects", function () {
            const result = rust.testsNamedMapWithConversion();
            assert.deepEqual(result.origin, { x: 0, y: 0 });
            assert.deepEqual(result.point, { x: 5, y: -3 });
        });
    });
});
