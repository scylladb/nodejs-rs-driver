"use strict";

import Row = require("./row");
import { ColumnInfo, convertComplexType } from "./cql-utils";
import Encoder = require("../encoder");
import rust = require("../../index");
import assert = require("assert");

/**
 * Column metadata as exposed by {@link ResultSet#columns}.
 */
export interface ColumnMetadata {
    ksname: string;
    tablename: string;
    name: string;
    type: ColumnInfo;
}

interface ResultColumns {
    names: Array<string>;
    types: Array<ColumnInfo>;
}

/**
 * Converted result columns of one prepared statement handle.
 *
 * Goal: cache the converted result metadata (column names and types) on the JS side.
 * Converting it from Rust to JS takes many N-API calls per column. Without the cache,
 * this conversion runs for each result. With it, it runs only when the result metadata
 * of the prepared statement changes.
 *
 * Rust tags each result of the handle with a metadata generation.
 * The same generation means the same column names and types,
 * so the converted columns are reused until the generation changes.
 * @internal
 */
export class ResultColumnsCache {
    #generation: number | undefined;
    #columns: ResultColumns | undefined;

    /** Returns the columns of the result, converting them only when the generation changes. */
    get(result: rust.QueryResultWrapper): ResultColumns {
        const generation = result.getMetadataGeneration();
        // Rust tags every rows result of a prepared handle with a generation.
        assert(generation != null);
        if (generation !== this.#generation || !this.#columns) {
            this.#columns = readColumns(result);
            this.#generation = generation;
        }
        return this.#columns;
    }
}

function readColumns(result: rust.QueryResultWrapper): ResultColumns {
    return {
        names: result.getColumnsNames(),
        types: result.getColumnsTypes().map((typ) => convertComplexType(typ)),
    };
}

/**
 * Simple way of getting results from rust driver.
 * Calls the driver, decoding the whole page at once.
 * @param columnsCache Converted columns of the prepared handle that produced the result, when available.
 * @returns Returns array of rows if the result is of the RowsResult kind, and undefined otherwise
 */
export function getRowsFromResultsWrapper(
    result: rust.QueryResultWrapper,
    encoder: Encoder,
    columnsCache?: ResultColumnsCache,
): Array<Row> | undefined {
    // The shared page is safe here when buffer-valued cells are copied by the
    // decoder. With copyBuffer disabled, preserve the independent page buffer.
    const data = encoder.encodingOptions.copyBuffer
        ? result.getRowsShared()
        : result.getRows();
    if (data == null) {
        // Empty results are treated as undefined
        return undefined;
    }
    const rawPage = data[0];
    const rowLength = data[1];

    const columns = columnsCache
        ? columnsCache.get(result)
        : readColumns(result);

    return encoder.decodeRows(rawPage, rowLength, columns.names, columns.types);
}

export function getColumnsMetadata(
    result: rust.QueryResultWrapper,
): Array<ColumnMetadata> {
    const res: Array<ColumnMetadata> = [];
    const columnsWrapper = result.getColumnsSpecs();
    // TODO: Here, we ask for column type again, despite already requesting that info at the value deserialization
    // While this provides some overhead, this is an overhead in requesting metadata, which we do not focus on optimizing
    // (and this endpoint is lazy - meaning it's not called in the benchmarks)
    const columnsTypes = result
        .getColumnsTypes()
        .map((typ) => convertComplexType(typ));
    for (let i = 0; i < columnsWrapper.length; i++) {
        const e = columnsWrapper[i];
        res.push({
            ksname: e.ksname,
            tablename: e.tablename,
            name: e.name,
            type: columnsTypes[i],
        });
    }
    return res;
}
