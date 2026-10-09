"use strict";

const { assert } = require("chai");
const rust = require("../../index");
const {
    getRowsFromResultsWrapper,
    ResultMetadataCache,
} = require("../../lib/types/results-wrapper");

const encoder = {
    encodingOptions: { copyBuffer: false },
    decodeRows: (_raw, _count, names, types) => ({ names, types }),
};

describe("prepared result metadata cache", () => {
    function result(id, name, type) {
        const calls = { names: 0, types: 0 };
        return {
            calls,
            getRows: () => [Buffer.alloc(0), 1],
            getResultMetadataId: () => id,
            getColumnsNames: () => {
                calls.names++;
                return [name];
            },
            getColumnsTypes: () => {
                calls.types++;
                return [{ baseType: type }];
            },
        };
    }

    function decode(resultWrapper, cache, statement) {
        return getRowsFromResultsWrapper(resultWrapper, encoder, {
            cache,
            statement,
        });
    }

    it("reuses names and types across separate results with the same ID", () => {
        const cache = new ResultMetadataCache();
        const first = result(Buffer.from([1]), "value", rust.CqlType.Int);
        const second = result(Buffer.from([1]), "value", rust.CqlType.Int);
        const firstColumns = decode(first, cache, "SELECT value FROM t");
        const secondColumns = decode(second, cache, "SELECT value FROM t");

        assert.strictEqual(first.calls.names, 1);
        assert.strictEqual(first.calls.types, 1);
        assert.strictEqual(second.calls.names, 0);
        assert.strictEqual(second.calls.types, 0);
        assert.strictEqual(secondColumns.names, firstColumns.names);
        assert.strictEqual(secondColumns.types, firstColumns.types);
    });

    it("refreshes types when an ID changes even if column names match", () => {
        const cache = new ResultMetadataCache();
        const oldResult = result(Buffer.from([1]), "value", rust.CqlType.Int);
        const newResult = result(Buffer.from([2]), "value", rust.CqlType.Text);
        const repeatedResult = result(
            Buffer.from([2]),
            "value",
            rust.CqlType.Text,
        );

        assert.strictEqual(
            decode(oldResult, cache, "SELECT value FROM t").types[0].code,
            rust.CqlType.Int,
        );
        assert.strictEqual(
            decode(newResult, cache, "SELECT value FROM t").types[0].code,
            rust.CqlType.Text,
        );
        assert.strictEqual(newResult.calls.types, 1);
        assert.strictEqual(
            decode(repeatedResult, cache, "SELECT value FROM t").types[0].code,
            rust.CqlType.Text,
        );
        assert.strictEqual(repeatedResult.calls.types, 0);
    });

    it("reads metadata every time when the server supplies no ID", () => {
        const cache = new ResultMetadataCache();
        const first = result(null, "value", rust.CqlType.Int);
        const second = result(null, "value", rust.CqlType.Text);

        decode(first, cache, "SELECT value FROM t");
        assert.strictEqual(
            decode(second, cache, "SELECT value FROM t").types[0].code,
            rust.CqlType.Text,
        );
        assert.strictEqual(first.calls.types, 1);
        assert.strictEqual(second.calls.types, 1);
    });

    it("does not cache an empty ID", () => {
        const cache = new ResultMetadataCache();
        const first = result(Buffer.alloc(0), "value", rust.CqlType.Int);
        const second = result(Buffer.alloc(0), "value", rust.CqlType.Text);

        decode(first, cache, "SELECT value FROM t");
        assert.strictEqual(
            decode(second, cache, "SELECT value FROM t").types[0].code,
            rust.CqlType.Text,
        );
        assert.strictEqual(second.calls.types, 1);
    });

    it("does not request an ID without a prepared cache context", () => {
        const queryResult = result(Buffer.from([1]), "value", rust.CqlType.Int);
        queryResult.getResultMetadataId = () => {
            assert.fail("unexpected metadata ID request");
        };

        getRowsFromResultsWrapper(queryResult, encoder);
        assert.strictEqual(queryResult.calls.types, 1);
    });

    it("keeps different statements separate", () => {
        const cache = new ResultMetadataCache();
        const first = result(Buffer.from([1]), "value", rust.CqlType.Int);
        const second = result(Buffer.from([1]), "value", rust.CqlType.Text);

        decode(first, cache, "SELECT value FROM a");
        assert.strictEqual(
            decode(second, cache, "SELECT value FROM b").types[0].code,
            rust.CqlType.Text,
        );
        assert.strictEqual(second.calls.types, 1);
    });

    it("evicts the oldest statement at capacity without evicting on replacement", () => {
        const cache = new ResultMetadataCache();
        const id = Buffer.from([1]);
        const columns = { names: ["value"], types: [] };
        for (let i = 0; i < 512; i++) {
            cache.set(`SELECT ${i}`, id, columns);
        }
        cache.set("SELECT 0", id, columns);
        assert.strictEqual(cache.get("SELECT 0", id).names, columns.names);

        cache.set("SELECT 512", id, columns);
        assert.isUndefined(cache.get("SELECT 0", id));
        assert.strictEqual(cache.get("SELECT 1", id).names, columns.names);
    });
});
