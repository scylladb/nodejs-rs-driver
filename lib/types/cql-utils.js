"use strict";

const rust = require("../../index");
const _Encoder = require("../encoder");

/**
 * @param {Array<rust.ComplexType | null>} expectedTypes List of expected types.
 * @param {Array<any>} params
 * @param {_Encoder} encoder
 * @returns {Array<rust.ComplexType|any>} Returns: [] for null values, [undefined] for unset values
 * and [rust.ComplexType, any] for all other values.
 * @throws ResponseError when received different amount of parameters than expected
 */
function encodeParams(expectedTypes, params, encoder) {
    if (expectedTypes.length == 0 && !params) return [];
    let res = [];
    for (let i = 0; i < params.length; i++) {
        let tmp = encoder.encode(params[i], expectedTypes[i]);
        res.push(tmp);
    }
    return res;
}

/**
 * Convert rust ComplexType into type representation used in the driver encoder
 * @param {rust.ComplexType} type
 */
function convertComplexType(type) {
    try {
        /**
         * @type {rust.CqlType}
         */
        let baseType = type.baseType;
        let data = {
            code: baseType.valueOf(),
        };
        switch (baseType) {
            case rust.CqlType.List:
            case rust.CqlType.Set:
                data.info = convertComplexType(type.subtype1);
                break;
            case rust.CqlType.Map:
                data.info = [
                    convertComplexType(type.subtype1),
                    convertComplexType(type.subtype2),
                ];
                break;
            case rust.CqlType.Vector:
                data = {
                    code: rust.CqlType.Custom,
                    customTypeName: "vector",
                    info: [convertComplexType(type.subtype1), type.dimensions],
                };
                break;
            case rust.CqlType.UserDefinedType:
                data.info = {
                    name: type.name,
                    fields: type.udt_types.map((typ, index) => {
                        let obj = { type: convertComplexType(typ) };
                        obj.name = type.udt_name[index];
                        return obj;
                    }),
                };
                break;
            case rust.CqlType.Tuple:
                data.info = type.subtypes.map((typ) => convertComplexType(typ));
                break;
            default:
                break;
        }
        return data;
    } catch (e) {
        // In this function we do not call other functions, so any error that we may catch here,
        // is due to unexpected structure of ComplexType received from rust driver.
        // However, this should never happen, as any valid ColumnType in rust will generate a valid converted type.
        throw new Error(
            `Error converting ComplexType: ${e.message}. This is likely due to a bug in the driver.`,
        );
    }
}

module.exports.encodeParams = encodeParams;
module.exports.convertComplexType = convertComplexType;
