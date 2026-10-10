"use strict";

const { assert } = require("chai");
const rust = require("../../index");
const {
    getRowsFromResultsWrapper,
    ResultColumnsCache,
} = require("../../lib/types/results-wrapper");

const encoder = {
    encodingOptions: { copyBuffer: false },
    decodeRows: (_raw, _count, names, types) => ({ names, types }),
};

describe("prepared result columns cache", () => {
    function result(generation, name, type) {
        const calls = { names: 0, types: 0 };
        return {
            calls,
            getRows: () => [Buffer.alloc(0), 1],
            getMetadataGeneration: () => generation,
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

    it("reuses names and types across results with the same generation", () => {
        const cache = new ResultColumnsCache();
        const first = result(0, "value", rust.CqlType.Int);
        const second = result(0, "value", rust.CqlType.Int);
        const firstColumns = getRowsFromResultsWrapper(first, encoder, cache);
        const secondColumns = getRowsFromResultsWrapper(second, encoder, cache);

        assert.strictEqual(first.calls.names, 1);
        assert.strictEqual(first.calls.types, 1);
        assert.strictEqual(second.calls.names, 0);
        assert.strictEqual(second.calls.types, 0);
        assert.strictEqual(secondColumns.names, firstColumns.names);
        assert.strictEqual(secondColumns.types, firstColumns.types);
    });

    it("refreshes names and types when the generation changes", () => {
        const cache = new ResultColumnsCache();
        const oldResult = result(0, "value", rust.CqlType.Int);
        const newResult = result(1, "value", rust.CqlType.Text);
        const repeated = result(1, "value", rust.CqlType.Text);

        assert.strictEqual(
            getRowsFromResultsWrapper(oldResult, encoder, cache).types[0].code,
            rust.CqlType.Int,
        );
        assert.strictEqual(
            getRowsFromResultsWrapper(newResult, encoder, cache).types[0].code,
            rust.CqlType.Text,
        );
        assert.strictEqual(
            getRowsFromResultsWrapper(repeated, encoder, cache).types[0].code,
            rust.CqlType.Text,
        );
        assert.strictEqual(newResult.calls.names, 1);
        assert.strictEqual(repeated.calls.names, 0);
        assert.strictEqual(repeated.calls.types, 0);
    });

    it("rejects a result without a generation", () => {
        const cache = new ResultColumnsCache();
        const untagged = result(null, "value", rust.CqlType.Int);

        assert.throws(() =>
            getRowsFromResultsWrapper(untagged, encoder, cache),
        );
    });

    it("does not ask for a generation without a cache", () => {
        const queryResult = result(0, "value", rust.CqlType.Int);
        queryResult.getMetadataGeneration = () => {
            assert.fail("unexpected metadata generation request");
        };

        getRowsFromResultsWrapper(queryResult, encoder);
        assert.strictEqual(queryResult.calls.types, 1);
    });
});
