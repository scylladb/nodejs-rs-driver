import { CqlType } from "../../index";

/** Options grouping for column information.
 * This option grouping is present to make this interface backward compatible. */
export interface ColumnInfoOptions {
    /** This flag is only used in schema metadata. 
     * For prepared statement bind markers and query result
     * types those fields will always be set to `false` (even if the DB column
     * corresponding to given marker / result type is frozen).  */
    frozen?: boolean;
    // This is a legacy field that was present in the DSx code.
    // It corresponds to org.apache.cassandra.db.marshal.ReversedType from the CQL.
    // We are not using this field at the moment.
    // It's likely we will want to remove this field at some point
    reversed?: boolean;
}

/** Single field of the user-defined type - (name, type) pair */
export interface UdtField {
    name: string;
    type: ColumnInfo;
}

/** Definition of a user-defined type (UDT).
 *  UDT is composed of fields, each with a name and an optional value of its own type. */
export interface UdtInfo {
    /** Name of the user-defined type. */
    name: string;
    fields: UdtField[];
}

// ColumnInfo as a class is based on this monstrosity of a type
// Current type does not restrict the info type based on the code.
// For now this is not a problem, but this may come up when converting encoder to TS.
// /**
//  * @typedef {(singleTypeNames<keyof singleTypeNames>| types.dataTypes.duration | types.dataTypes.text)} SingleTypeCodes
//  * @typedef {{code : SingleTypeCodes, info?: null, options? : {frozen?:boolean, reversed?:boolean} }} SingleColumnInfo
//  * @typedef {{code : (types.dataTypes.map), info : [ColumnInfo, ColumnInfo], options?: {frozen?: Boolean, reversed?: Boolean}}} MapColumnInfo
//  * @typedef {{code : (types.dataTypes.tuple), info : Array<ColumnInfo>, options?: {frozen?: Boolean, reversed?: Boolean}}} TupleColumnInfo
//  * @typedef {{code : (types.dataTypes.tuple | types.dataTypes.list)}} TupleListColumnInfoWithoutSubtype TODO: guessDataType can return null on tuple/list info, why?
//  * @typedef {{code : (types.dataTypes.list | types.dataTypes.set), info : ColumnInfo, options?: {frozen?: Boolean, reversed?: Boolean}}} ListSetColumnInfo
//  * @typedef {{code : (types.dataTypes.udt), info : {name : string, fields : Array<{name : string, type : ColumnInfo}>}, options? : {frozen?: Boolean, reversed?: Boolean}}} UdtColumnInfo
//  * @typedef {{code : (types.dataTypes.custom), customTypeName : ('vector'), info : [ColumnInfo, number], options? : {frozen?:boolean, reversed?:boolean}}} VectorColumnInfo
//  * @typedef {{code : (types.dataTypes.custom), info : string, options? : {frozen?:boolean, reversed?:boolean}}} OtherCustomColumnInfo
//  * @typedef {SingleColumnInfo | MapColumnInfo | TupleColumnInfo | ListSetColumnInfo | VectorColumnInfo | OtherCustomColumnInfo | UdtColumnInfo | TupleListColumnInfoWithoutSubtype} ColumnInfo If this is a simple type, info is null; if this is a collection type with a simple subtype, info is a string, if this is a nested collection type, info is a ColumnInfo object
//  */

/**
 * Describes CQL column type information.
 *
 * The `info` field varies depending on the type code:
 * - Simple types: `info` is `null`
 * - List/Set: `info` is a `ColumnInfo` for the element type
 * - Map: `info` is a tuple `[ColumnInfo, ColumnInfo]` for key and value types
 * - Tuple: `info` is an array of `ColumnInfo` for each element
 * - UDT: `info` is a `UdtInfo` with name and fields
 * - Vector (custom): `info` is a tuple `[ColumnInfo, number]` for element type and dimension
 * - Other custom: `info` is a string
 */
export class ColumnInfo {
    code: CqlType;
    info:
        | null
        | ColumnInfo
        | [ColumnInfo, ColumnInfo]
        | ColumnInfo[]
        | UdtInfo
        | [ColumnInfo, number]
        | string;
    options?: ColumnInfoOptions;
    /** Only present for vector custom types */
    customTypeName?: string;

    constructor(
        code: CqlType,
    ) {
        this.code = code;
        this.info = null;
    }
}
