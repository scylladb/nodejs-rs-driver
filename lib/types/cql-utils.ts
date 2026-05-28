import { ComplexType, CqlType } from "../../index";
import CI = require("./column-info");
import Encoder = require("../encoder");

/**
 * @param expectedTypes List of expected types.
 * @param params
 * @param encoder
 * @returns Returns: [] for null values, [undefined] for unset values
 * and [ComplexType, any] for all other values.
 * @throws ResponseError when received different amount of parameters than expected
 */
export function encodeParams(
    expectedTypes: Array<CI.ColumnInfo | null>,
    params: Array<unknown>,
    encoder: Encoder,
): Array<unknown> {
    if (expectedTypes.length == 0 && !params) return [];
    const res: Array<unknown> = [];
    for (let i = 0; i < params.length; i++) {
        const tmp = encoder.encode(params[i], expectedTypes[i]);
        res.push(tmp);
    }
    return res;
}

/**
 * Convert rust ComplexType into type representation used in the driver encoder
 */
export function convertComplexType(type: ComplexType): CI.ColumnInfo {
    try {
        let data = new CI.ColumnInfo(type.baseType.valueOf());
        switch (type.baseType) {
            case CqlType.List:
            case CqlType.Set:
                data.info = convertComplexType(type.subtype1);
                break;
            case CqlType.Map:
                data.info = [
                    convertComplexType(type.subtype1),
                    convertComplexType(type.subtype2),
                ];
                break;
            case CqlType.Vector:
                data = new CI.ColumnInfo(CqlType.Custom);
                data.customTypeName = "vector";
                data.info = [convertComplexType(type.subtype1), type.dimensions];
                break;
            case CqlType.UserDefinedType:
                data.info = {
                    name: type.name,
                    fields: type.udt_types.map(
                        (typ: ComplexType, index: number) => ({
                            type: convertComplexType(typ),
                            name: type.udt_name[index],
                        }),
                    ),
                };
                break;
            case CqlType.Tuple:
                data.info = type.subtypes.map((typ: ComplexType) =>
                    convertComplexType(typ),
                );
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
            `Error converting ComplexType: ${e instanceof Error ? e.message : ""}. This is likely due to a bug in the driver.`,
        );
    }
}
