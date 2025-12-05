"use strict";

const { assert } = require("chai");
const utils = require("../../lib/utils");
const types = require("../../lib/types");
const helper = require("../test-helper");
const { ResultSet } = types;

describe("ResultSet", function () {
    describe("#first()", function () {
        it("should return the first row", function () {
            const result = new ResultSet({ rows: [400, 420] }, null);
            assert.strictEqual(result.first(), 400);
        });

        it("should return null when rows is not defined", function () {
            const result = new ResultSet({}, null);
            assert.strictEqual(result.first(), null);
        });
    });

    describe("#[@@iterator]()", function () {
        it("should return the rows iterator", function () {
            const result = new ResultSet({ rows: [100, 200, 300] });
            // Equivalent of for..of result
            const iterator = result[Symbol.iterator]();
            let item = iterator.next();
            assert.strictEqual(item.done, false);
            assert.strictEqual(item.value, 100);
            item = iterator.next();
            assert.strictEqual(item.done, false);
            assert.strictEqual(item.value, 200);
            item = iterator.next();
            assert.strictEqual(item.done, false);
            assert.strictEqual(item.value, 300);
            assert.strictEqual(iterator.next().done, true);
        });

        it("should return an empty iterator when rows is not defined", function () {
            const result = new ResultSet({}, null);
            // Equivalent of for..of result
            const iterator = result[Symbol.iterator]();
            const item = iterator.next();
            assert.ok(item);
            assert.strictEqual(item.done, true);
            assert.strictEqual(item.value, undefined);
        });
    });

    if (Symbol.asyncIterator !== undefined) {
        describe("#[@@asyncIterator]()", function () {
            it("should return the first page when pageState is not set", async () => {
                const rows = [100, 200, 300];
                const rs = new ResultSet({ rows });
                const result = await helper.asyncIteratorToArray(rs);
                assert.deepStrictEqual(result, rows);
            });

            it("should reject when rawNextPageAsync is not set", async () => {
                const rs = new ResultSet({
                    rows: [100],
                    meta: { pageState: utils.allocBuffer(1) },
                });
                const iterator = rs[Symbol.asyncIterator]();
                const item = await iterator.next();
                assert.deepEqual(item, { value: 100, done: false });
                await helper.assertThrowsAsync(
                    iterator.next(),
                    null,
                    "Property rawNextPageAsync",
                );
            });
        });

        describe("#isPaged()", () => {
            it("should return false when page state is not defined", () => {
                const rs = new ResultSet({ rows: [100] });
                assert.strictEqual(rs.isPaged(), false);
            });

            it("should return false when page state is undefined", () => {
                const rs = new ResultSet({
                    rows: [100],
                    meta: { pageState: undefined },
                });
                assert.strictEqual(rs.isPaged(), false);
            });

            it("should return true when page state is set", () => {
                const rs = new ResultSet({
                    rows: [100],
                    meta: { pageState: utils.allocBuffer(1) },
                });
                assert.strictEqual(rs.isPaged(), true);
            });
        });
    }
});
