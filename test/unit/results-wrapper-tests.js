"use strict";

const { assert } = require("chai");
const rust = require("../../index");
const { CqlType } = rust;
const ResultSet = require("../../lib/types/result-set");
const {
    getRowsFromResultsWrapper,
} = require("../../lib/types/results-wrapper");

describe("paged result column decoding", function () {
    function page(columns, sameAsPrevious) {
        const calls = { names: 0, types: 0, snapshots: 0, comparisons: [] };
        const snapshot = {};
        return {
            calls,
            snapshot,
            getRows: () => [Buffer.alloc(0), 1],
            hasSameColumnsAs(previous) {
                calls.comparisons.push(previous);
                return sameAsPrevious;
            },
            getColumnsSnapshot() {
                calls.snapshots++;
                return snapshot;
            },
            getColumnsNames() {
                calls.names++;
                return columns.map((column) => column[0]);
            },
            getColumnsTypes() {
                calls.types++;
                return columns.map((column) => column[1]);
            },
        };
    }

    it("does not create a snapshot without a page cache", function () {
        const result = page([["value", { baseType: CqlType.Int }]], false);
        const encoder = { decodeRows: () => [] };

        getRowsFromResultsWrapper(result, encoder);

        assert.strictEqual(result.calls.snapshots, 0);
        assert.deepEqual(result.calls.comparisons, []);
    });

    it("does not snapshot a single-page result with an unused cache", function () {
        const result = Object.assign(
            Object.create(rust.QueryResultWrapper.prototype),
            page([["value", { baseType: CqlType.Int }]], false),
        );
        new ResultSet(result, { decodeRows: () => [] }, null, {});

        assert.strictEqual(result.calls.snapshots, 0);
    });

    it("reuses types on unchanged pages and refreshes them before decoding changed pages", function () {
        const cache = {};
        const decoded = [];
        const encoder = {
            decodeRows(_buffer, _count, names, types) {
                decoded.push([names.slice(), types.map((type) => type.code)]);
                return [];
            },
        };
        const first = page([["old", { baseType: CqlType.Int }]], false);
        const second = page([["old", { baseType: CqlType.Int }]], true);
        const changed = page([["new", { baseType: CqlType.Varchar }]], false);
        const afterChange = page(
            [["new", { baseType: CqlType.Varchar }]],
            true,
        );

        getRowsFromResultsWrapper(first, encoder, cache);
        getRowsFromResultsWrapper(second, encoder, cache);
        getRowsFromResultsWrapper(changed, encoder, cache);
        getRowsFromResultsWrapper(afterChange, encoder, cache);

        assert.deepEqual(decoded, [
            [["old"], [CqlType.Int]],
            [["old"], [CqlType.Int]],
            [["new"], [CqlType.Varchar]],
            [["new"], [CqlType.Varchar]],
        ]);
        assert.deepEqual(first.calls, {
            names: 1,
            types: 1,
            snapshots: 1,
            comparisons: [],
        });
        assert.deepEqual(second.calls, {
            names: 0,
            types: 0,
            snapshots: 0,
            comparisons: [first.snapshot],
        });
        assert.deepEqual(changed.calls, {
            names: 1,
            types: 1,
            snapshots: 1,
            comparisons: [first.snapshot],
        });
        assert.strictEqual(cache.page.snapshot, changed.snapshot);
        assert.deepEqual(afterChange.calls, {
            names: 0,
            types: 0,
            snapshots: 0,
            comparisons: [changed.snapshot],
        });
    });

    it("keeps the old cache entry when conversion of changed metadata fails", function () {
        const cache = {};
        const decoded = [];
        const encoder = {
            decodeRows(_buffer, _count, names, types) {
                decoded.push([names[0], types[0].code]);
                return [];
            },
        };
        const first = page([["old", { baseType: CqlType.Int }]], false);
        const invalid = page([["new", { baseType: CqlType.List }]], false);
        const retry = page([["old", { baseType: CqlType.Int }]], true);

        getRowsFromResultsWrapper(first, encoder, cache);
        assert.throws(() => getRowsFromResultsWrapper(invalid, encoder, cache));
        getRowsFromResultsWrapper(retry, encoder, cache);

        assert.deepEqual(decoded, [
            ["old", CqlType.Int],
            ["old", CqlType.Int],
        ]);
        assert.strictEqual(cache.page.snapshot, first.snapshot);
        assert.deepEqual(retry.calls.comparisons, [first.snapshot]);
    });

    it("reuses the first page metadata in an async result iterator", async function () {
        const first = Object.assign(
            Object.create(rust.QueryResultWrapper.prototype),
            page([["value", { baseType: CqlType.Int }]], false),
            { getRows: () => [Buffer.from([1]), 1] },
        );
        const next = Object.assign(
            Object.create(rust.QueryResultWrapper.prototype),
            page([["value", { baseType: CqlType.Int }]], true),
            { getRows: () => [Buffer.from([2]), 1] },
        );
        const encoder = {
            decodeRows(buffer) {
                return [{ value: buffer[0] }];
            },
        };
        const result = new ResultSet(first, encoder, {
            getRawPageState: () => Buffer.from([1]),
        });
        result.rawNextPageAsync = async () => [null, next];

        const rows = [];
        for await (const row of result) rows.push(row.value);

        assert.deepEqual(rows, [1, 2]);
        assert.strictEqual(first.calls.types, 1);
        assert.strictEqual(next.calls.types, 0);
        assert.deepEqual(next.calls.comparisons, [first.snapshot]);
    });
});
