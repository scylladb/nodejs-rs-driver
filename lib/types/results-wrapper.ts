"use strict";

import Row = require("./row");
import { ColumnInfo, convertComplexType } from "./cql-utils";
import Encoder = require("../encoder");
import errors = require("../errors");
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

/** Decoding metadata shared only between pages of one query. */
export interface DecodedColumns {
    page?: {
        snapshot: rust.ColumnSpecsSnapshot;
        names: Array<string>;
        types: Array<ColumnInfo>;
    };
}

/**
 * Simple way of getting results from rust driver.
 * Calls the driver, decoding the whole page at once.
 * @param columns Mutable cache used only when following pages can reuse metadata.
 * @returns Returns array of rows if the result is of the RowsResult kind, and undefined otherwise
 */
export function getRowsFromResultsWrapper(
    result: rust.QueryResultWrapper,
    encoder: Encoder,
    columns?: DecodedColumns,
): Array<Row> | undefined {
    const data = result.getRows();
    if (data == null) {
        // Empty results are treated as undefined
        return undefined;
    }
    const rawPage = data[0];
    const rowLength = data[1];

    let page = columns?.page;
    if (!page || !result.hasSameColumnsAs(page.snapshot)) {
        const names = result.getColumnsNames();
        const types = result
            .getColumnsTypes()
            .map((typ) => convertComplexType(typ));
        if (!columns) {
            return encoder.decodeRows(rawPage, rowLength, names, types);
        }
        const snapshot = result.getColumnsSnapshot();
        if (!snapshot) {
            throw new errors.DriverInternalError(
                "Rows result did not provide a column snapshot",
            );
        }
        page = { snapshot, names, types };
        columns.page = page;
    }

    return encoder.decodeRows(rawPage, rowLength, page.names, page.types);
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
