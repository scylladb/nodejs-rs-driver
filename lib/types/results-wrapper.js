"use strict";

const _Row = require("./row");
const { convertComplexType } = require("./cql-utils");
const _Encoder = require("../encoder");

/**
 * Simple way of getting results from rust driver.
 * Call the driver O(columns * rows) times
 * @param {rust.QueryResultWrapper} result
 * @param {_Encoder} encoder
 * @returns {Array<_Row> | undefined} Returns array of rows if the result is is of the RowsResult kind, and undefined otherwise
 */
function getRowsFromResultsWrapper(result, encoder) {
    let data = result.getRows();
    if (data == null) {
        // Empty results are treated as undefined
        return undefined;
    }
    let rawPage = data[0];
    let rowLength = data[1];

    let colNames = result.getColumnsNames();
    let types = result.getColumnsTypes().map((typ) => convertComplexType(typ));

    return encoder.decodeRows(rawPage, rowLength, colNames, types);
}

/**
 *
 * @param {rust.QueryResultWrapper} result
 * @returns {Array.<{name, type}>}
 */
function getColumnsMetadata(result) {
    let res = [];
    let columnsWrapper = result.getColumnsSpecs();
    // TODO: Here, we ask for column type again, despite already requesting that info at the value deserialization
    // While this provides some overhead, this is an overhead in requesting metadata, which we do not focus on optimizing
    // (and this endpoint is lazy - meaning it's not called in the benchmarks)
    let columnsTypes = result
        .getColumnsTypes()
        .map((typ) => convertComplexType(typ));
    for (let i = 0; i < columnsWrapper.length; i++) {
        let e = columnsWrapper[i];
        res.push({
            ksname: e.ksname,
            tablename: e.tablename,
            name: e.name,
            type: columnsTypes[i],
        });
    }
    return res;
}

module.exports.getRowsFromResultsWrapper = getRowsFromResultsWrapper;
module.exports.getColumnsMetadata = getColumnsMetadata;
