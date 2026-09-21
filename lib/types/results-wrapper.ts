"use strict";

import Row = require("./row");
import { ColumnInfo, convertComplexType } from "./cql-utils";
// TODO: Remove once lib/encoder.js is converted to TypeScript.
// @ts-ignore - untyped JS module
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

/**
 * Simple way of getting results from rust driver.
 * Call the driver O(columns * rows) times
 * @returns Returns array of rows if the result is is of the RowsResult kind, and undefined otherwise
 */
export function getRowsFromResultsWrapper(
    result: rust.QueryResultWrapper,
    encoder: Encoder,
): Array<Row> | undefined {
    const data = result.getRows();
    if (data == null) {
        // Empty results are treated as undefined
        return undefined;
    }
    const rawPage = data[0];
    const rowLength = data[1];

    const colNames = result.getColumnsNames();
    const types = result
        .getColumnsTypes()
        .map((typ) => convertComplexType(typ));

    return encoder.decodeRows(rawPage, rowLength, colNames, types);
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
