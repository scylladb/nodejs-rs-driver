"use strict";

const rust = require("../../index");
const BigDecimal = require("./big-decimal");
const Uuid = require("./uuid");
const TimeUuid = require("./time-uuid");
const Duration = require("./duration");
const LocalTime = require("./local-time");
const InetAddress = require("./inet-address");
const LocalDate = require("./local-date");
const { bigintToLong } = require("../new-utils");
const _Row = require("./row");
const Tuple = require("./tuple");
const { convertComplexType } = require("./cql-utils");
const Vector = require("./vector");
const { getDataTypeNameByCode } = require(".");
const _Encoder = require("../encoder");

/**
 * Maps the value returned from the Rust driver into expected JS object, based on the provided type information.
 *
 * @param {rust.CqlValueWrapper} field
 * @param {{code: number, info: *|Object}} typ
 * @returns {any}
 */
function getCqlObject(field, typ) {
    switch (true) {
        case field === null:
            return null;
        case field instanceof rust.LocalDateWrapper:
            return LocalDate.fromRust(field);
        case field instanceof rust.DurationWrapper:
            return Duration.fromRust(field);
        case field instanceof rust.InetAddressWrapper:
            return InetAddress.fromRust(field);
        case field instanceof rust.LocalTimeWrapper:
            return LocalTime.fromRust(field);
    }
    let res;
    let value = field;
    switch (typ.code) {
        case rust.CqlType.Int:
        case rust.CqlType.SmallInt:
        case rust.CqlType.TinyInt:
        case rust.CqlType.Text:
        case rust.CqlType.Varchar:
        case rust.CqlType.Blob:
        case rust.CqlType.Boolean:
        case rust.CqlType.Ascii:
        case rust.CqlType.Double:
        case rust.CqlType.Float:
            return value;
        case rust.CqlType.BigInt:
            return bigintToLong(value);
        case rust.CqlType.Counter:
            return value;
        case rust.CqlType.Decimal:
            return BigDecimal.fromBuffer(value);
        case rust.CqlType.Timestamp:
            // Currently only values inside Date safe range are supported
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#the_epoch_timestamps_and_invalid_date
            // The same problem exists in Datastax driver. This probably should be fixed at some point,
            // but it's unlikely someone will need timestamps almost 300.000 years into the future.
            return new Date(Number(value));
        case rust.CqlType.Map:
            res = {};
            for (const keyValuePair of value) {
                res[getCqlObject(keyValuePair[0], typ.info[0])] = getCqlObject(
                    keyValuePair[1],
                    typ.info[1],
                );
            }
            return res;
        case rust.CqlType.Timeuuid:
            return TimeUuid.fromRust(value);
        case rust.CqlType.Tuple:
            return Tuple.fromArray(
                value.map((element, index) =>
                    element === null
                        ? undefined
                        : getCqlObject(element, typ.info[index]),
                ),
            );
        case rust.CqlType.Uuid:
            return Uuid.fromRust(value);
        case rust.CqlType.Set:
        case rust.CqlType.List:
            return value.map((v) => getCqlObject(v, typ.info));
        case rust.CqlType.UserDefinedType:
            // Considering an Object is just a dictionary, we map here from a Dict<Key, Value> to Dict<Key, getCqlObject(Value)>
            // Dictionary elements are not yet converted values returned from Rust,
            // so we need to recursively convert those elements into expected types
            return Object.fromEntries(
                Object.entries(value).map(([key, elem], index) => {
                    return [
                        key,
                        getCqlObject(elem, typ.info.fields[index].type),
                    ];
                }),
            );
        case rust.CqlType.Varint:
            return value;
        case rust.CqlType.Custom:
            if (typ.customTypeName === "vector") {
                return new Vector(
                    value.map((v) => getCqlObject(v, typ.info[0])),
                    getDataTypeNameByCode(typ.info[0]),
                );
            }
            throw new Error(`Unexpected custom type (${typ.customTypeName})`);
        default:
            throw new Error(`Unexpected type (${typ})`);
    }
}

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

module.exports.getCqlObject = getCqlObject;
module.exports.getRowsFromResultsWrapper = getRowsFromResultsWrapper;
module.exports.getColumnsMetadata = getColumnsMetadata;
