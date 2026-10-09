"use strict";

import Row = require("./row");
import { ColumnInfo, convertComplexType } from "./cql-utils";
import Encoder = require("../encoder");
import rust = require("../../index");

/**
 * Column metadata as exposed by {@link ResultSet#columns}.
 */
export interface ColumnMetadata {
    ksname: string;
    tablename: string;
    name: string;
    type: ColumnInfo;
}

interface CachedColumns {
    names: Array<string>;
    types: Array<ColumnInfo>;
}

interface CachedPreparedColumns extends CachedColumns {
    id: Buffer;
}

/**
 * Caches column names and converted types for prepared results with a server metadata ID.
 * Only results passed through Client.rustyExecute use this cache; internally fetched
 * later pages keep their existing decoding path. At capacity, the first inserted
 * statement is evicted, even if it was subsequently read or replaced.
 */
export class ResultMetadataCache {
    private readonly entries = new Map<string, CachedPreparedColumns>();
    private static readonly maxEntries = 512;

    /** Returns columns only while the statement's server metadata ID matches. */
    get(statement: string, id: Buffer): CachedColumns | undefined {
        const columns = this.entries.get(statement);
        return columns?.id.equals(id) ? columns : undefined;
    }

    /** Replaces a statement's entry and evicts the first inserted key at capacity. */
    set(statement: string, id: Buffer, columns: CachedColumns): void {
        if (
            !this.entries.has(statement) &&
            this.entries.size >= ResultMetadataCache.maxEntries
        ) {
            this.entries.delete(this.entries.keys().next().value!);
        }
        this.entries.set(statement, { ...columns, id });
    }
}

/** Identifies the prepared statement whose result may use cached columns. */
export interface ResultMetadataContext {
    cache: ResultMetadataCache;
    statement: string;
}

/**
 * Simple way of getting results from rust driver.
 * Calls the driver, decoding the whole page at once.
 * @param cacheContext Cache and statement for a prepared result, when available.
 * @returns Returns array of rows if the result is of the RowsResult kind, and undefined otherwise
 */
export function getRowsFromResultsWrapper(
    result: rust.QueryResultWrapper,
    encoder: Encoder,
    cacheContext?: ResultMetadataContext,
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

    const id = cacheContext ? result.getResultMetadataId() : undefined;
    let columns =
        cacheContext && id?.length
            ? cacheContext.cache.get(cacheContext.statement, id)
            : undefined;
    if (!columns) {
        columns = {
            names: result.getColumnsNames(),
            types: result
                .getColumnsTypes()
                .map((typ) => convertComplexType(typ)),
        };
        if (cacheContext && id?.length) {
            cacheContext.cache.set(cacheContext.statement, id, columns);
        }
    }

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
