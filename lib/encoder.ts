"use strict";
import util = require("util");

import types = require("./types");
const dataTypes = types.dataTypes;
const Long = types.Long;
/**
 * @deprecated Integer is deprecated. See `./types/integer.ts`
 */
const Integer = types.Integer;
const BigDecimal = types.BigDecimal;
import utils = require("./utils");
import token = require("./token");
// TODO: Remove after lib/datastax/search is converted to Typescript.
// @ts-ignore
import { DateRange } from "./datastax/search";
import Vector = require("./types/vector");
import { throwNotSupported } from "./new-utils";
import { FrameReader } from "./reader";
import { ColumnInfo, UdtInfo } from "./types/cql-utils";
import type { ExecutionOptions } from "./execution-options";
import { GrowableBuffer } from "./growable-buffer";

const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const buffers = {
    int8Zero: utils.allocBufferFromArray([0]),
    int8MaxValue: utils.allocBufferFromArray([0xff]),
};

/** The length of a null cell in a request frame. */
const NULL_CELL_LENGTH = -1;
/** The length of an unset cell in a request frame. */
const UNSET_CELL_LENGTH = -2;
/**
 * The largest upper bound of the byte length of a string that a string encoder makes room for.
 * Measuring the exact byte length costs one more pass over the string.
 * Thus, when the buffer has no room for the upper bound, a string encoder makes room:
 * - for the upper bound, when it is at most this size,
 * - else for the exact byte length.
 *
 * Examples, in UTF-8, where the upper bound is 3 bytes for each UTF-16 code unit:
 * - "hello": the upper bound is 15 bytes. The encoder makes room for 15 bytes,
 *   and it does not measure the string.
 * - 30,000 ASCII characters: the upper bound is 90,000 bytes, more than this size.
 *   The encoder measures the string: 30,000 bytes. A buffer of 4 KiB grows to 32 KiB.
 *   With the upper bound, it would grow to 128 KiB. That is more than the 64 KiB that
 *   FrameWriter keeps between frames. Then FrameWriter would allocate a new buffer
 *   for each such request.
 */
const MAX_STRING_GROWTH_BY_UPPER_BOUND = 16 * 1024;
/**
 * The size of the new buffer that {@link Encoder.encode} gives to an encoder.
 * It has room for the largest value of a fixed-size type: a uuid or an IPv6 address, 16 bytes.
 * Thus, encode does not grow the buffer for a value of a fixed-size type.
 * It must not be 0, because {@link GrowableBuffer.ensure} doubles the size.
 */
const NEW_BUFFER_SIZE = 16;

/**
 * Writes the bytes of one value at `start` in `out`.
 * It does not write the length of the value: the caller writes it.
 * @returns The offset after the bytes.
 */
type ValueEncoder = (
    out: GrowableBuffer,
    start: number,
    value: any,
    columnInfo: ColumnInfo,
) => number;

/**
 * Calls an encoder with a new small buffer.
 * @returns A view of the bytes that the encoder wrote.
 */
function writeToNewBuffer(
    thisArg: EncoderMembers,
    encoder: ValueEncoder,
    value: any,
    columnInfo: ColumnInfo,
): Buffer {
    const out = new GrowableBuffer(NEW_BUFFER_SIZE);
    const end = encoder.call(thisArg, out, 0, value, columnInfo);
    return out.buffer.subarray(0, end);
}

const bigInt32BitsOn = BigInt(0xffffffff);
const bigInt8BitsOn = BigInt(0xff);
const bigIntZero = BigInt(0);
const bigIntMinusOne = BigInt(-1);
const bigIntEight = BigInt(8);
const bigIntThirtyTwo = BigInt(32);

const complexTypeNames = Object.freeze({
    list: "org.apache.cassandra.db.marshal.ListType",
    set: "org.apache.cassandra.db.marshal.SetType",
    map: "org.apache.cassandra.db.marshal.MapType",
    udt: "org.apache.cassandra.db.marshal.UserType",
    tuple: "org.apache.cassandra.db.marshal.TupleType",
    frozen: "org.apache.cassandra.db.marshal.FrozenType",
    reversed: "org.apache.cassandra.db.marshal.ReversedType",
    composite: "org.apache.cassandra.db.marshal.CompositeType",
    empty: "org.apache.cassandra.db.marshal.EmptyType",
    collection: "org.apache.cassandra.db.marshal.ColumnToCollectionType",
});
const cqlNames = Object.freeze({
    frozen: "frozen",
    list: "list",
    set: "set",
    map: "map",
    tuple: "tuple",
    empty: "empty",
    duration: "duration",
    vector: "vector",
});
const singleTypeNames = Object.freeze({
    "org.apache.cassandra.db.marshal.UTF8Type": dataTypes.varchar,
    "org.apache.cassandra.db.marshal.AsciiType": dataTypes.ascii,
    "org.apache.cassandra.db.marshal.UUIDType": dataTypes.uuid,
    "org.apache.cassandra.db.marshal.TimeUUIDType": dataTypes.timeuuid,
    "org.apache.cassandra.db.marshal.Int32Type": dataTypes.int,
    "org.apache.cassandra.db.marshal.BytesType": dataTypes.blob,
    "org.apache.cassandra.db.marshal.FloatType": dataTypes.float,
    "org.apache.cassandra.db.marshal.DoubleType": dataTypes.double,
    "org.apache.cassandra.db.marshal.BooleanType": dataTypes.boolean,
    "org.apache.cassandra.db.marshal.InetAddressType": dataTypes.inet,
    "org.apache.cassandra.db.marshal.SimpleDateType": dataTypes.date,
    "org.apache.cassandra.db.marshal.TimeType": dataTypes.time,
    "org.apache.cassandra.db.marshal.ShortType": dataTypes.smallint,
    "org.apache.cassandra.db.marshal.ByteType": dataTypes.tinyint,
    "org.apache.cassandra.db.marshal.DateType": dataTypes.timestamp,
    "org.apache.cassandra.db.marshal.TimestampType": dataTypes.timestamp,
    "org.apache.cassandra.db.marshal.LongType": dataTypes.bigint,
    "org.apache.cassandra.db.marshal.DecimalType": dataTypes.decimal,
    "org.apache.cassandra.db.marshal.IntegerType": dataTypes.varint,
    "org.apache.cassandra.db.marshal.CounterColumnType": dataTypes.counter,
});

const singleFqTypeNamesLength = Object.keys(singleTypeNames).reduce(function (
    previous,
    current,
) {
    return current.length > previous ? current.length : previous;
}, 0);

const customTypeNames = Object.freeze({
    duration: "org.apache.cassandra.db.marshal.DurationType",
    vector: "org.apache.cassandra.db.marshal.VectorType",
});

/**
 * For backwards compatibility, empty buffers as text/blob/custom values are supported.
 * In the case of other types, they are going to be decoded as a `null` value.
 * @private
 */
const zeroLengthTypesSupported = new Set([
    dataTypes.text,
    dataTypes.ascii,
    dataTypes.varchar,
    dataTypes.custom,
    dataTypes.blob,
]);

const customDecoders: { [typeName: string]: (bytes: Buffer) => any } = {
    [customTypeNames.duration]: decodeDuration,
};

const customEncoders: { [typeName: string]: (value: any) => Buffer } = {
    [customTypeNames.duration]: encodeDuration,
};

/**
 * Gets the type from type information given as a hint:
 * a type, a type name such as "int", or a type code.
 * @throws {TypeError} When the type information is not valid
 */
function typeFromHint(typeInfo: any): any {
    let type: any = null;
    if (typeof typeInfo === "number") {
        type = {
            code: typeInfo,
        };
    } else if (typeof typeInfo === "string") {
        type = dataTypes.getByName(typeInfo);
    } else if (
        typeInfo !== null &&
        typeof typeInfo === "object" &&
        typeof typeInfo.code === "number"
    ) {
        type = typeInfo;
    }
    // A type code is an integer, also in a type object.
    if (type == null || !Number.isInteger(type.code)) {
        throw new TypeError(
            "Type information not valid, only String and Number values are valid hints",
        );
    }
    return type;
}

/**
 * Checks that a UDT type has its fields, and that each field has a type.
 * @throws {TypeError} When the type information is not valid
 */
function checkUdtInfo(udtInfo: UdtInfo | undefined): void {
    if (!udtInfo || !Array.isArray(udtInfo.fields)) {
        throw new TypeError(
            "Type information not valid, a UDT type needs its fields",
        );
    }
    // An index loop, not for...of or some: they skip the holes of a sparse array.
    for (let i = 0; i < udtInfo.fields.length; i++) {
        const field = udtInfo.fields[i];
        if (!field || field.type === null || field.type === undefined) {
            throw new TypeError(
                "Type information not valid, a UDT type needs the type of each field",
            );
        }
        // The Encoder reads each field of a value by its name.
        // A name that is not a string would read an unrelated property.
        if (typeof field.name !== "string" || field.name === "") {
            throw new TypeError(
                "Type information not valid, a UDT type needs a non-empty name for each field",
            );
        }
    }
}

/**
 * Checks that a tuple type has at least one item, and a type for each item.
 * @throws {TypeError} When the type information is not valid
 */
function checkTupleInfo(tupleInfo: Array<ColumnInfo> | undefined): void {
    const message =
        "Type information not valid, a tuple type needs the types of its items";
    if (!Array.isArray(tupleInfo) || tupleInfo.length === 0) {
        throw new TypeError(message);
    }
    // An index loop, not for...of or some: they skip the holes of a sparse array.
    for (let i = 0; i < tupleInfo.length; i++) {
        if (tupleInfo[i] === null || tupleInfo[i] === undefined) {
            throw new TypeError(message);
        }
    }
}

/**
 * Checks that a vector type has its element type and a positive integer dimension.
 * @throws {TypeError} When the type information is not valid
 */
function checkVectorInfo(info: any): void {
    if (
        !Array.isArray(info) ||
        info.length !== 2 ||
        info[0] === null ||
        info[0] === undefined ||
        !Number.isInteger(info[1]) ||
        info[1] <= 0
    ) {
        throw new TypeError(
            "Type information not valid, a vector type needs its element type and a positive dimension",
        );
    }
}

/**
 * Declares the privileged instance members.
 * Due to historical reasons, it was always separate from Encoder.
 * It's likely because previously Encoder was exposed in the API (it no longer is)
 * and such separation allowed to keep members of this class private (invisible in the public API docs).
 * Currently it's kept separate to easier code reading / editing.
 * This class focuses on encoding/decoding methods for individual types,
 * while Encoder "public" (only for the driver) part of the API.
 * You can only use this class through Encoder, and do not instantiate it directly.
 * @abstract
 */
class EncoderMembers {
    encodingOptions: any;
    protocolVersion!: number;

    /** Selected from the encoding options, once, in the constructor. */
    decodeBigInt: (bytes: Buffer) => types.Long | bigint;
    decodeVarint: (bytes: Buffer) => types.Integer | bigint;
    encodeBigInt: ValueEncoder;
    encodeVarint: (value: any) => Buffer;

    decoders: {
        [code: number]: (bytes: Buffer, columnInfo: ColumnInfo) => any;
    };
    legacyEncoders: {
        [code: number]: (value: any, columnInfo: ColumnInfo) => Buffer | null;
    };
    /**
     * Writes values straight into a buffer, for the types that have an encoder.
     * A type has an encoder or an entry in {@link legacyEncoders}, never both.
     */
    encoders: { [code: number]: ValueEncoder };

    /** Selected from the protocol version by {@link setProtocolVersion}. */
    decodeCollectionLength!: (bytes: Buffer, offset: number) => number;
    collectionLengthSize!: number;

    /** Selected from the encoding options by the {@link Encoder} constructor. */
    handleBuffer!: (buffer: Buffer) => Buffer;

    /** Implemented by {@link Encoder}, which is the only way to reach this class. */
    encode(value: any, typeInfo?: any): Buffer | null | undefined {
        throw new SyntaxError(
            "Internal driver error: EncoderMembers cannot encode on its own",
        );
    }

    constructor(encodingOptions: any) {
        if (new.target === EncoderMembers) {
            throw new SyntaxError(
                "Internal driver error: EncoderMembers cannot be instantiated directly",
            );
        }
        this.encodingOptions = encodingOptions;

        this.decodeBigInt = encodingOptions.useBigIntAsLong
            ? this.#decodeCqlLongAsBigInt
            : this.#decodeCqlLongAsLong;

        this.decodeVarint = encodingOptions.useBigIntAsVarint
            ? this.#decodeVarintAsBigInt
            : this.#decodeVarintAsInteger;

        this.encodeBigInt = encodingOptions.useBigIntAsLong
            ? this.#encodeBigIntFromBigInt
            : this.#encodeBigIntFromLong;

        this.encodeVarint = encodingOptions.useBigIntAsVarint
            ? this.#encodeVarintFromBigInt
            : this.#encodeVarintFromInteger;

        this.decoders = {
            [dataTypes.custom]: this.decodeCustom,
            [dataTypes.ascii]: this.decodeAsciiString,
            [dataTypes.bigint]: this.decodeBigInt,
            [dataTypes.blob]: this.decodeBlob,
            [dataTypes.boolean]: this.decodeBoolean,
            [dataTypes.counter]: this.decodeBigInt,
            [dataTypes.decimal]: this.decodeDecimal,
            [dataTypes.double]: this.decodeDouble,
            [dataTypes.float]: this.decodeFloat,
            [dataTypes.int]: this.decodeInt,
            [dataTypes.text]: this.decodeUtf8String,
            [dataTypes.timestamp]: this.decodeTimestamp,
            [dataTypes.uuid]: this.decodeUuid,
            [dataTypes.varchar]: this.decodeUtf8String,
            [dataTypes.varint]: this.decodeVarint,
            [dataTypes.timeuuid]: this.decodeTimeUuid,
            [dataTypes.inet]: this.decodeInet,
            [dataTypes.date]: this.decodeDate,
            [dataTypes.time]: this.decodeTime,
            [dataTypes.smallint]: this.decodeSmallint,
            [dataTypes.tinyint]: this.decodeTinyint,
            [dataTypes.duration]: decodeDuration,
            [dataTypes.list]: this.decodeList,
            [dataTypes.map]: this.decodeMap,
            [dataTypes.set]: this.decodeSet,
            [dataTypes.udt]: this.decodeUdt,
            [dataTypes.tuple]: this.decodeTuple,
        };

        this.legacyEncoders = {
            [dataTypes.decimal]: this.encodeDecimal,
            [dataTypes.varint]: this.encodeVarint,
            [dataTypes.duration]: encodeDuration,
        };

        this.encoders = {
            [dataTypes.ascii]: this.encodeAsciiString,
            [dataTypes.bigint]: this.encodeBigInt,
            [dataTypes.counter]: this.encodeBigInt,
            [dataTypes.text]: this.encodeUtf8String,
            [dataTypes.varchar]: this.encodeUtf8String,
            [dataTypes.blob]: this.encodeBlob,
            [dataTypes.boolean]: this.encodeBoolean,
            [dataTypes.date]: this.encodeDate,
            [dataTypes.time]: this.encodeTime,
            [dataTypes.double]: this.encodeDouble,
            [dataTypes.float]: this.encodeFloat,
            [dataTypes.inet]: this.encodeInet,
            [dataTypes.smallint]: this.encodeSmallint,
            [dataTypes.tinyint]: this.encodeTinyint,
            [dataTypes.int]: this.encodeInt,
            [dataTypes.timestamp]: this.encodeTimestamp,
            [dataTypes.timeuuid]: this.encodeUuid,
            [dataTypes.uuid]: this.encodeUuid,
        };
    }

    /**
     * Sets the protocol version and the encoding/decoding methods depending on the protocol version
     * @ignore
     * @internal
     */
    setProtocolVersion(value: number): void {
        this.protocolVersion = value;
        // Set the collection serialization based on the protocol version
        this.decodeCollectionLength = decodeCollectionLengthV3;
        this.collectionLengthSize = 4;
        if (
            !types.protocolVersion.uses4BytesCollectionLength(
                this.protocolVersion,
            )
        ) {
            this.decodeCollectionLength = decodeCollectionLengthV2;
            this.collectionLengthSize = 2;
        }
    }

    /* Stub for decode method. Proper decode will be provided by the Encoder. */
    decode(bytes: Buffer | null, columnInfo: ColumnInfo): any {
        throw new Error(
            "Using stub of decoder. This is an internal driver error.",
        );
    }

    /**
     * @private
     */
    decodeBlob(bytes: Buffer): Buffer {
        return this.handleBuffer(bytes);
    }

    /**
     * @private
     */
    decodeCustom(bytes: Buffer, columnInfo: ColumnInfo): any {
        // Make sure we actually have something to process in typeName before we go any further
        if (!columnInfo) {
            return this.handleBuffer(bytes);
        }

        // Special handling for vector custom types (since they have args)
        if (
            "customTypeName" in columnInfo &&
            columnInfo.customTypeName === "vector"
        ) {
            return this.decodeVector(bytes, columnInfo);
        }

        if (
            typeof columnInfo.info === "string" &&
            columnInfo.info.startsWith(customTypeNames.vector)
        ) {
            const vectorColumnInfo = this.parseFqTypeName(columnInfo.info);
            return this.decodeVector(bytes, vectorColumnInfo);
        }

        const handler = customDecoders[columnInfo.info as string];
        if (handler) {
            return handler.call(this, bytes);
        }
        return this.handleBuffer(bytes);
    }

    /**
     * @private
     */
    decodeUtf8String(bytes: Buffer): string {
        return bytes.toString("utf8");
    }

    /**
     * @private
     */
    decodeAsciiString(bytes: Buffer): string {
        return bytes.toString("ascii");
    }

    /**
     * @private
     */
    decodeBoolean(bytes: Buffer): boolean {
        return !!bytes.readUInt8(0);
    }

    /**
     * @private
     */
    decodeDouble(bytes: Buffer): number {
        return bytes.readDoubleBE(0);
    }

    /**
     * @private
     */
    decodeFloat(bytes: Buffer): number {
        return bytes.readFloatBE(0);
    }

    /**
     * @private
     */
    decodeInt(bytes: Buffer): number {
        return bytes.readInt32BE(0);
    }

    /**
     * @private
     */
    decodeSmallint(bytes: Buffer): number {
        return bytes.readInt16BE(0);
    }

    /**
     * @private
     */
    decodeTinyint(bytes: Buffer): number {
        return bytes.readInt8(0);
    }

    /**
     * @private
     */
    #decodeCqlLongAsLong(bytes: Buffer): types.Long {
        return (Long as any).fromBuffer(bytes);
    }

    /**
     * @private
     */
    #decodeCqlLongAsBigInt(bytes: Buffer): bigint {
        return BigInt.asIntN(
            64,
            (BigInt(bytes.readUInt32BE(0)) << bigIntThirtyTwo) |
                BigInt(bytes.readUInt32BE(4)),
        );
    }

    /**
     * @private
     */
    #decodeVarintAsInteger(bytes: Buffer): types.Integer {
        return Integer.fromBuffer(bytes);
    }

    /**
     * @private
     */
    #decodeVarintAsBigInt(bytes: Buffer): bigint {
        let result = bigIntZero;
        if (bytes[0] <= 0x7f) {
            for (let i = 0; i < bytes.length; i++) {
                const b = BigInt(bytes[bytes.length - 1 - i]);
                result = result | (b << BigInt(i * 8));
            }
        } else {
            for (let i = 0; i < bytes.length; i++) {
                const b = BigInt(bytes[bytes.length - 1 - i]);
                result = result | ((~b & bigInt8BitsOn) << BigInt(i * 8));
            }
            result = ~result;
        }

        return result;
    }

    /**
     * @private
     */
    decodeDecimal(bytes: Buffer): types.BigDecimal {
        return BigDecimal.fromBuffer(bytes);
    }

    /**
     * @private
     */
    decodeTimestamp(bytes: Buffer): Date {
        return new Date(this.#decodeCqlLongAsLong(bytes).toNumber());
    }

    /**
     * @private
     */
    decodeDate(bytes: Buffer): types.LocalDate {
        return types.LocalDate.fromBuffer(bytes);
    }

    /**
     * @private
     */
    decodeTime(bytes: Buffer): types.LocalTime {
        return types.LocalTime.fromBuffer(bytes);
    }

    /**
     * Reads a list from bytes
     * @private
     */
    decodeList(bytes: Buffer, columnInfo: ColumnInfo): Array<any> {
        const subtype = columnInfo.info as ColumnInfo;
        const totalItems = this.decodeCollectionLength(bytes, 0);
        let offset = this.collectionLengthSize;
        const list = new Array(totalItems);
        for (let i = 0; i < totalItems; i++) {
            // bytes length of the item
            const length = this.decodeCollectionLength(bytes, offset);
            offset += this.collectionLengthSize;
            // slice it
            list[i] = this.decode(
                bytes.slice(offset, offset + length),
                subtype,
            );
            offset += length;
        }
        return list;
    }

    /**
     * Reads a Set from bytes
     * @private
     */
    decodeSet(bytes: Buffer, columnInfo: ColumnInfo): any {
        const arr = this.decodeList(bytes, columnInfo);
        if (this.encodingOptions.set) {
            const setConstructor = this.encodingOptions.set;
            return new setConstructor(arr);
        }
        return arr;
    }

    /**
     * Reads a map (key / value) from bytes
     * @private
     */
    decodeMap(bytes: Buffer, columnInfo: ColumnInfo): any {
        const subtypes = columnInfo.info as [ColumnInfo, ColumnInfo];
        let map: any;
        const totalItems = this.decodeCollectionLength(bytes, 0);
        let offset = this.collectionLengthSize;
        const readValues = (
            callback: (key: any, value: any) => void,
            thisArg?: any,
        ) => {
            for (let i = 0; i < totalItems; i++) {
                const keyLength = this.decodeCollectionLength(bytes, offset);
                offset += this.collectionLengthSize;
                const key = this.decode(
                    bytes.slice(offset, offset + keyLength),
                    subtypes[0],
                );
                offset += keyLength;
                const valueLength = this.decodeCollectionLength(bytes, offset);
                offset += this.collectionLengthSize;
                if (valueLength < 0) {
                    callback.call(thisArg, key, null);
                    continue;
                }
                const value = this.decode(
                    bytes.slice(offset, offset + valueLength),
                    subtypes[1],
                );
                offset += valueLength;
                callback.call(thisArg, key, value);
            }
        };
        if (this.encodingOptions.map) {
            const mapConstructor = this.encodingOptions.map;
            map = new mapConstructor();
            readValues(map.set, map);
        } else {
            map = {};
            readValues(function (key: any, value: any) {
                map[key] = value;
            });
        }
        return map;
    }

    /**
     * @private
     */
    decodeUuid(bytes: Buffer): types.Uuid {
        return new types.Uuid(this.handleBuffer(bytes));
    }

    /**
     * @private
     */
    decodeTimeUuid(bytes: Buffer): types.TimeUuid {
        return new types.TimeUuid(this.handleBuffer(bytes));
    }

    /**
     * @private
     */
    decodeInet(bytes: Buffer): types.InetAddress {
        return new types.InetAddress(this.handleBuffer(bytes));
    }

    /**
     * Decodes a user defined type into an object
     * @private
     */
    decodeUdt(bytes: Buffer, columnInfo: ColumnInfo): any {
        const udtInfo = columnInfo.info as UdtInfo;
        const result: { [field: string]: any } = {};
        let offset = 0;
        for (
            let i = 0;
            i < udtInfo.fields.length && offset < bytes.length;
            i++
        ) {
            // bytes length of the field value
            const length = bytes.readInt32BE(offset);
            offset += 4;
            // slice it
            const field = udtInfo.fields[i];
            if (length < 0) {
                result[field.name] = null;
                continue;
            }
            result[field.name] = this.decode(
                bytes.slice(offset, offset + length),
                field.type,
            );
            offset += length;
        }
        return result;
    }

    /**
     * @private
     */
    decodeTuple(bytes: Buffer, columnInfo: ColumnInfo): types.Tuple {
        const tupleInfo = columnInfo.info as Array<ColumnInfo>;
        const elements = new Array(tupleInfo.length);
        let offset = 0;

        for (let i = 0; i < tupleInfo.length && offset < bytes.length; i++) {
            const length = bytes.readInt32BE(offset);
            offset += 4;

            if (length < 0) {
                elements[i] = null;
                continue;
            }

            elements[i] = this.decode(
                bytes.slice(offset, offset + length),
                tupleInfo[i],
            );
            offset += length;
        }

        return types.Tuple.fromArray(elements);
    }

    /**
     * @private
     */
    encodeFloat(out: GrowableBuffer, start: number, value: any): number {
        if (typeof value === "string") {
            // All numeric types are supported as strings for historical reasons
            value = parseFloat(value);

            if (Number.isNaN(value)) {
                throw new TypeError(
                    `Expected string representation of a number, obtained ${util.inspect(value)}`,
                );
            }
        }

        if (typeof value !== "number") {
            throw new TypeError(
                "Expected Number, obtained " + util.inspect(value),
            );
        }

        out.ensure(start, 4);
        return out.buffer.writeFloatBE(value, start);
    }

    /**
     * @private
     */
    encodeDouble(out: GrowableBuffer, start: number, value: any): number {
        if (typeof value === "string") {
            // All numeric types are supported as strings for historical reasons
            value = parseFloat(value);

            if (Number.isNaN(value)) {
                throw new TypeError(
                    `Expected string representation of a number, obtained ${util.inspect(value)}`,
                );
            }
        }

        if (typeof value !== "number") {
            throw new TypeError(
                "Expected Number, obtained " + util.inspect(value),
            );
        }

        out.ensure(start, 8);
        return out.buffer.writeDoubleBE(value, start);
    }

    /**
     * @private
     */
    encodeTimestamp(
        out: GrowableBuffer,
        start: number,
        value: any,
        columnInfo: ColumnInfo,
    ): number {
        const originalValue = value;
        if (typeof value === "string") {
            value = new Date(value);
        }
        if (value instanceof Date) {
            // milliseconds since epoch
            value = value.getTime();
            if (isNaN(value)) {
                throw new TypeError("Invalid date: " + originalValue);
            }
        }
        if (this.encodingOptions.useBigIntAsLong) {
            value = BigInt(value);
        }
        return this.encodeBigInt(out, start, value, columnInfo);
    }

    /**
     * @private
     */
    encodeDate(out: GrowableBuffer, start: number, value: any): number {
        const originalValue = value;
        try {
            if (typeof value === "string") {
                value = types.LocalDate.fromString(value);
            }
            if (value instanceof Date) {
                value = types.LocalDate.fromDate(value);
            }
        } catch (err) {
            // Wrap into a TypeError
            throw new TypeError("LocalDate could not be parsed " + err);
        }
        if (!(value instanceof types.LocalDate)) {
            throw new TypeError(
                "Expected Date/String/LocalDate, obtained " +
                    util.inspect(originalValue),
            );
        }
        return value.appendTo(out, start);
    }

    /**
     * @private
     */
    encodeTime(out: GrowableBuffer, start: number, value: any): number {
        const originalValue = value;
        try {
            if (typeof value === "string") {
                value = types.LocalTime.fromString(value);
            }
        } catch (err) {
            // Wrap into a TypeError
            throw new TypeError("LocalTime could not be parsed " + err);
        }
        if (!(value instanceof types.LocalTime)) {
            throw new TypeError(
                "Expected String/LocalTime, obtained " +
                    util.inspect(originalValue),
            );
        }
        return value.appendTo(out, start);
    }

    /**
     * @private
     */
    encodeUuid(out: GrowableBuffer, start: number, value: any): number {
        if (typeof value === "string") {
            try {
                value = types.Uuid.fromString(value).getBuffer();
            } catch (err) {
                throw new TypeError((err as Error).message);
            }
        } else if (value instanceof types.Uuid) {
            value = value.getBuffer();
        } else {
            throw new TypeError(
                "Not a valid Uuid, expected Uuid/String/Buffer, obtained " +
                    util.inspect(value),
            );
        }

        out.ensure(start, value.length);
        return start + value.copy(out.buffer, start);
    }

    /**
     * @private
     */
    encodeInet(out: GrowableBuffer, start: number, value: any): number {
        if (typeof value === "string") {
            value = types.InetAddress.fromString(value);
        }
        if (value instanceof types.InetAddress) {
            value = value.getBuffer();
        }
        if (!(value instanceof Buffer)) {
            throw new TypeError(
                "Not a valid Inet, expected InetAddress/Buffer, obtained " +
                    util.inspect(value),
            );
        }
        out.ensure(start, value.length);
        return start + value.copy(out.buffer, start);
    }

    /**
     * @private
     */
    #encodeBigIntFromLong(
        out: GrowableBuffer,
        start: number,
        value: any,
    ): number {
        if (typeof value === "number") {
            value = Long.fromNumber(value);
        } else if (typeof value === "string") {
            value = Long.fromString(value);
        }

        if (!(value instanceof Long)) {
            throw new TypeError(
                "Not a valid bigint, expected Long/Number/String/Buffer, obtained " +
                    util.inspect(value),
            );
        }

        out.ensure(start, 8);
        out.buffer.writeUInt32BE(value.getHighBitsUnsigned(), start);
        out.buffer.writeUInt32BE(value.getLowBitsUnsigned(), start + 4);
        return start + 8;
    }

    /**
     * @private
     */
    #encodeBigIntFromBigInt(
        out: GrowableBuffer,
        start: number,
        value: any,
    ): number {
        if (typeof value === "string") {
            // All numeric types are supported as strings for historical reasons
            value = BigInt(value);
        }

        if (typeof value !== "bigint") {
            // Only BigInt values are supported
            throw new TypeError(
                "Not a valid BigInt value, obtained " + util.inspect(value),
            );
        }

        out.ensure(start, 8);
        out.buffer.writeUInt32BE(Number(value >> bigIntThirtyTwo) >>> 0, start);
        out.buffer.writeUInt32BE(Number(value & bigInt32BitsOn), start + 4);
        return start + 8;
    }

    /**
     * @private
     */
    #encodeVarintFromInteger(value: any): Buffer {
        if (typeof value === "number") {
            value = Integer.fromNumber(value);
        }
        if (typeof value === "string") {
            value = Integer.fromString(value);
        }
        let buf: Buffer | null = null;
        if (value instanceof Buffer) {
            buf = value;
        }
        if (value instanceof Integer) {
            buf = Integer.toBuffer(value);
        }
        if (buf === null) {
            throw new TypeError(
                "Not a valid varint, expected Integer/Number/String/Buffer, obtained " +
                    util.inspect(value),
            );
        }
        return buf;
    }

    /**
     * @private
     */
    #encodeVarintFromBigInt(value: any): Buffer {
        if (typeof value === "string") {
            // All numeric types are supported as strings for historical reasons
            value = BigInt(value);
        }

        if (typeof value !== "bigint") {
            throw new TypeError(
                "Not a valid varint, expected BigInt, obtained " +
                    util.inspect(value),
            );
        }

        if (value === bigIntZero) {
            return buffers.int8Zero;
        } else if (value === bigIntMinusOne) {
            return buffers.int8MaxValue;
        }

        const parts: Array<number> = [];

        if (value > bigIntZero) {
            while (value !== bigIntZero) {
                parts.unshift(Number(value & bigInt8BitsOn));
                value = value >> bigIntEight;
            }

            if (parts[0] > 0x7f) {
                // Positive value needs a padding
                parts.unshift(0);
            }
        } else {
            while (value !== bigIntMinusOne) {
                parts.unshift(Number(value & bigInt8BitsOn));
                value = value >> bigIntEight;
            }

            if (parts[0] <= 0x7f) {
                // Negative value needs a padding
                parts.unshift(0xff);
            }
        }

        return utils.allocBufferFromArray(parts);
    }

    /**
     * @private
     */
    encodeDecimal(value: any): Buffer {
        if (typeof value === "number") {
            value = BigDecimal.fromNumber(value);
        } else if (typeof value === "string") {
            value = BigDecimal.fromString(value);
        }

        if (value instanceof BigDecimal) {
            let buf = BigDecimal.toBuffer(value);
            return buf;
        }
        throw new TypeError(
            "Not a valid varint, expected BigDecimal/Number/String/Buffer, obtained " +
                util.inspect(value),
        );
    }

    /**
     * Writes a string in the given encoding.
     * @private
     */
    encodeString(
        out: GrowableBuffer,
        start: number,
        value: any,
        encoding: "utf8" | "ascii",
    ): number {
        if (typeof value !== "string") {
            throw new TypeError(
                "Not a valid text value, expected String obtained " +
                    util.inspect(value),
            );
        }
        // The upper bound of the byte length: 3 bytes for each UTF-16 code unit in UTF-8,
        // and 1 byte in ASCII. See MAX_STRING_GROWTH_BY_UPPER_BOUND.
        const maxBytes = encoding === "ascii" ? value.length : value.length * 3;
        if (start + maxBytes > out.buffer.length) {
            out.ensure(
                start,
                maxBytes <= MAX_STRING_GROWTH_BY_UPPER_BOUND
                    ? maxBytes
                    : Buffer.byteLength(value, encoding),
            );
        }
        return start + out.buffer.write(value, start, encoding);
    }

    /**
     * @private
     */
    encodeUtf8String(out: GrowableBuffer, start: number, value: any): number {
        return this.encodeString(out, start, value, "utf8");
    }

    /**
     * @private
     */
    encodeAsciiString(out: GrowableBuffer, start: number, value: any): number {
        return this.encodeString(out, start, value, "ascii");
    }
    /**
     * @private
     */
    encodeBlob(out: GrowableBuffer, start: number, value: any): number {
        if (!(value instanceof Buffer)) {
            throw new TypeError(
                "Not a valid blob, expected Buffer obtained " +
                    util.inspect(value),
            );
        }
        out.ensure(start, value.length);
        out.buffer.set(value, start);
        return start + value.length;
    }

    /**
     * @private
     */
    encodeBoolean(out: GrowableBuffer, start: number, value: any): number {
        out.ensure(start, 1);
        return out.buffer.writeUInt8(value ? 1 : 0, start);
    }

    /**
     * @private
     */
    encodeInt(out: GrowableBuffer, start: number, value: any): number {
        if (isNaN(value)) {
            throw new TypeError(
                "Expected Number, obtained " + util.inspect(value),
            );
        }
        out.ensure(start, 4);
        return out.buffer.writeInt32BE(value, start);
    }

    /**
     * @private
     */
    encodeSmallint(out: GrowableBuffer, start: number, value: any): number {
        if (isNaN(value)) {
            throw new TypeError(
                "Expected Number, obtained " + util.inspect(value),
            );
        }
        out.ensure(start, 2);
        return out.buffer.writeInt16BE(value, start);
    }

    /**
     * @private
     */
    encodeTinyint(out: GrowableBuffer, start: number, value: any): number {
        if (isNaN(value)) {
            throw new TypeError(
                "Expected Number, obtained " + util.inspect(value),
            );
        }
        out.ensure(start, 1);
        return out.buffer.writeInt8(value, start);
    }

    /**
     * @private
     */
    decodeVector(buffer: Buffer, params: any): Vector {
        const subtype = params.info[0];
        const dimension = params.info[1];
        const elemLength = this.serializationSizeIfFixed(subtype);

        const rv: Array<any> = [];
        let offset = 0;
        for (let i = 0; i < dimension; i++) {
            if (elemLength === -1) {
                // var sized
                const [size, bytesRead] = utils.VIntCoding.uvintUnpack(
                    buffer.subarray(offset),
                );
                offset += bytesRead;
                if (offset + size > buffer.length) {
                    throw new TypeError(
                        "Not enough bytes to decode the vector",
                    );
                }
                rv[i] = this.decode(
                    buffer.subarray(offset, offset + size),
                    subtype,
                );
                offset += size;
            } else {
                if (offset + elemLength > buffer.length) {
                    throw new TypeError(
                        "Not enough bytes to decode the vector",
                    );
                }
                rv[i] = this.decode(
                    buffer.subarray(offset, offset + elemLength),
                    subtype,
                );
                offset += elemLength;
            }
        }
        if (offset !== buffer.length) {
            throw new TypeError("Extra bytes found after decoding the vector");
        }
        const typeInfo = types.getDataTypeNameByCode(subtype);
        return new Vector(rv, typeInfo);
    }

    /**
     * Gets the size of each value of a type, when all its values have the same size.
     * @param cqlType The type. It can also be a hint: a type name or a type code.
     * @returns The size in bytes, or -1 for a type with values of different sizes.
     * @throws {TypeError} When the type information is not valid
     */
    serializationSizeIfFixed(cqlType: any): number {
        // Resolve a hint first: the switch needs the type code.
        // This also covers the element types of nested vectors.
        const type = typeFromHint(cqlType);
        switch (type.code) {
            case dataTypes.bigint:
                return 8;
            case dataTypes.boolean:
                return 1;
            case dataTypes.timestamp:
                return 8;
            case dataTypes.double:
                return 8;
            case dataTypes.float:
                return 4;
            case dataTypes.int:
                return 4;
            case dataTypes.timeuuid:
                return 16;
            case dataTypes.uuid:
                return 16;
            case dataTypes.custom:
                if (
                    "customTypeName" in type &&
                    type.customTypeName === "vector"
                ) {
                    checkVectorInfo(type.info);
                    const subtypeSerialSize = this.serializationSizeIfFixed(
                        type.info[0],
                    );
                    if (subtypeSerialSize === -1) {
                        return -1;
                    }
                    return subtypeSerialSize * type.info[1];
                }
                return -1;
            default:
                return -1;
        }
    }

    /**
     * Extract the (typed) arguments from a vector type
     *
     * @param stringToExclude Leading string indicating this is a vector type (to be excluded when eval'ing args)
     * @param subtypeResolveFn Function used to resolve subtype type; varies depending on type naming convention
     * @internal
     * @ignore
     */
    parseVectorTypeArgs(
        typeName: string,
        stringToExclude: string,
        subtypeResolveFn: (name: string) => any,
    ): any {
        const argsStartIndex = stringToExclude.length + 1;
        const argsLength = typeName.length - (stringToExclude.length + 2);
        const params = parseParams(typeName, argsStartIndex, argsLength);
        if (params.length === 2) {
            const columnInfo = {
                code: dataTypes.custom,
                info: [
                    subtypeResolveFn.bind(this)(params[0].trim()),
                    parseInt(params[1].trim(), 10),
                ],
                customTypeName: "vector",
            };
            return columnInfo;
        }

        throw new TypeError("Not a valid type " + typeName);
    }

    /**
     * If not provided, it uses the array of buffers or the parameters and hints to build the routingKey
     * @param [keys] parameter keys and positions in the params array
     * @throws TypeError
     * @internal
     * @ignore
     */
    setRoutingKeyFromUser(
        params: Array<any>,
        execOptions: ExecutionOptions,
        keys?: any,
    ): void {
        let totalLength = 0;
        const userRoutingKey = execOptions.getRoutingKey();
        if (Array.isArray(userRoutingKey)) {
            if (userRoutingKey.length === 1) {
                execOptions.setRoutingKey(userRoutingKey[0]);
                return;
            }

            // Its a composite routing key
            totalLength = 0;
            for (let i = 0; i < userRoutingKey.length; i++) {
                const item = userRoutingKey[i];
                if (!item) {
                    // Invalid routing key part provided by the user, clear the value
                    execOptions.setRoutingKey(null);
                    return;
                }
                totalLength += item.length + 3;
            }

            execOptions.setRoutingKey(
                concatRoutingKey(userRoutingKey, totalLength),
            );
            return;
        }
        // If routingKey is present, ensure it is a Buffer, Token, or TokenRange.  Otherwise throw an error.
        if (userRoutingKey) {
            if (
                userRoutingKey instanceof Buffer ||
                userRoutingKey instanceof token.Token ||
                userRoutingKey instanceof token.TokenRange
            ) {
                return;
            }

            throw new TypeError(
                `Unexpected routingKey '${util.inspect(userRoutingKey)}' provided. ` +
                    `Expected Buffer, Array<Buffer>, Token, or TokenRange.`,
            );
        }

        // If no params are present, return as routing key cannot be determined.
        if (!params || params.length === 0) {
            return;
        }

        let routingIndexes = execOptions.getRoutingIndexes();
        if (execOptions.getRoutingNames()) {
            routingIndexes = execOptions
                .getRoutingNames()!
                .map((k: string) => keys[k]);
        }
        if (!routingIndexes) {
            return;
        }

        const parts: Array<Buffer> = [];
        const hints = execOptions.getHints() || utils.emptyArray;

        const encodeParam = !keys
            ? (i: number) => this.encode(params[i], hints[i])
            : (i: number) => this.encode(params[i].value, hints[i]);

        try {
            totalLength = this.#encodeRoutingKeyParts(
                parts,
                routingIndexes,
                encodeParam,
            );
        } catch (e) {
            // There was an error encoding a parameter that is part of the routing key,
            // ignore now to fail afterwards
        }

        if (totalLength === 0) {
            return;
        }

        execOptions.setRoutingKey(concatRoutingKey(parts, totalLength));
    }

    /**
     * Sets the routing key in the options based on the prepared statement metadata.
     * @param meta Prepared metadata
     * @param params Array of parameters
     * @throws TypeError
     * @internal
     * @ignore
     */
    setRoutingKeyFromMeta(
        meta: any,
        params: Array<any>,
        execOptions: ExecutionOptions,
    ): void {
        const routingIndexes = execOptions.getRoutingIndexes();
        if (!routingIndexes) {
            return;
        }
        const parts = new Array(routingIndexes.length);
        const encodeParam = (i: number) => {
            const columnInfo = meta.columns[i];
            return this.encode(params[i], columnInfo ? columnInfo.type : null);
        };

        let totalLength = 0;

        try {
            totalLength = this.#encodeRoutingKeyParts(
                parts,
                routingIndexes,
                encodeParam,
            );
        } catch (e) {
            // There was an error encoding a parameter that is part of the routing key,
            // ignore now to fail afterwards
        }

        if (totalLength === 0) {
            return;
        }

        execOptions.setRoutingKey(concatRoutingKey(parts, totalLength));
    }

    /**
     * @returns The total length
     * @private
     */
    #encodeRoutingKeyParts(
        parts: Array<Buffer>,
        routingIndexes: Array<number>,
        encodeParam: (index: number) => any,
    ): number {
        let totalLength = 0;
        for (let i = 0; i < routingIndexes.length; i++) {
            const paramIndex = routingIndexes[i];
            if (paramIndex === undefined) {
                // Bad input from the user, ignore
                return 0;
            }

            const item = encodeParam(paramIndex);
            if (item === null || item === undefined || item === types.unset) {
                // The encoded partition key should an instance of Buffer
                // Let it fail later in the pipeline for null/undefined parameter values
                return 0;
            }

            // Per each part of the routing key, 3 extra bytes are needed
            totalLength += item.length + 3;
            parts[i] = item;
        }
        return totalLength;
    }

    /**
     * Parses a CQL name string into data type information
     * @async
     * @returns callback Callback invoked with err and  {{code: number, info: Object|Array<any>|null, options: {frozen: Boolean}}}
     * @internal
     * @throws {Error}
     * @ignore
     */
    async parseTypeName(
        keyspace: string,
        typeName: string,
        startIndex?: number,
        length?: number,
        udtResolver?: any,
    ): Promise<any> {
        startIndex = startIndex || 0;
        if (!length) {
            length = typeName.length;
        }

        let innerTypes;
        let frozen = false;

        if (typeName.indexOf("'", startIndex) === startIndex) {
            // If quoted, this is a custom type.
            const info = typeName.substr(startIndex + 1, length - 2);
            return {
                code: dataTypes.custom,
                info: info,
            };
        }

        if (!length) {
            length = typeName.length;
        }

        if (typeName.indexOf(cqlNames.frozen, startIndex) === startIndex) {
            // Remove the frozen token
            startIndex += cqlNames.frozen.length + 1;
            length -= cqlNames.frozen.length + 2;
            frozen = true;
        }

        if (typeName.indexOf(cqlNames.list, startIndex) === startIndex) {
            // move cursor across the name and bypass the angle brackets
            startIndex += cqlNames.list.length + 1;
            length -= cqlNames.list.length + 2;
            innerTypes = parseParams(typeName, startIndex, length, "<", ">");

            if (innerTypes.length !== 1) {
                throw new TypeError("Not a valid type " + typeName);
            }

            const info = await this.parseTypeName(
                keyspace,
                innerTypes[0],
                0,
                undefined,
                udtResolver,
            );
            return {
                code: dataTypes.list,
                info: info,
                options: {
                    frozen: frozen,
                },
            };
        }

        if (typeName.indexOf(cqlNames.set, startIndex) === startIndex) {
            // move cursor across the name and bypass the angle brackets
            startIndex += cqlNames.set.length + 1;
            length -= cqlNames.set.length + 2;
            innerTypes = parseParams(typeName, startIndex, length, "<", ">");

            if (innerTypes.length !== 1) {
                throw new TypeError("Not a valid type " + typeName);
            }

            const info = await this.parseTypeName(
                keyspace,
                innerTypes[0],
                0,
                undefined,
                udtResolver,
            );
            return {
                code: dataTypes.set,
                info: info,
                options: {
                    frozen: frozen,
                },
            };
        }

        if (typeName.indexOf(cqlNames.map, startIndex) === startIndex) {
            // move cursor across the name and bypass the angle brackets
            startIndex += cqlNames.map.length + 1;
            length -= cqlNames.map.length + 2;
            innerTypes = parseParams(typeName, startIndex, length, "<", ">");

            // It should contain the key and value types
            if (innerTypes.length !== 2) {
                throw new TypeError("Not a valid type " + typeName);
            }

            const info = await this.#parseChildTypes(
                keyspace,
                innerTypes,
                udtResolver,
            );
            return {
                code: dataTypes.map,
                info: info,
                options: {
                    frozen: frozen,
                },
            };
        }

        if (typeName.indexOf(cqlNames.tuple, startIndex) === startIndex) {
            // move cursor across the name and bypass the angle brackets
            startIndex += cqlNames.tuple.length + 1;
            length -= cqlNames.tuple.length + 2;
            innerTypes = parseParams(typeName, startIndex, length, "<", ">");

            if (innerTypes.length < 1) {
                throw new TypeError("Not a valid type " + typeName);
            }

            const info = await this.#parseChildTypes(
                keyspace,
                innerTypes,
                udtResolver,
            );
            return {
                code: dataTypes.tuple,
                info: info,
                options: { frozen: frozen },
            };
        }

        if (typeName.indexOf(cqlNames.vector, startIndex) === startIndex) {
            // It's a vector, so record the subtype and dimension.
            // parseVectorTypeArgs is not an async function but we are.  To keep things simple let's ask the
            // function to just return whatever it finds for an arg and we'll eval it after the fact
            const params = this.parseVectorTypeArgs.bind(this)(
                typeName,
                cqlNames.vector,
                (arg) => arg,
            );
            params["info"][0] = await this.parseTypeName(
                keyspace,
                params["info"][0],
            );

            return params;
        }

        const quoted = typeName.indexOf('"', startIndex) === startIndex;
        if (quoted) {
            // Remove quotes
            startIndex++;
            length -= 2;
        }

        // Quick check if its a single type
        if (startIndex > 0) {
            typeName = typeName.substr(startIndex, length);
        }

        // Un-escape double quotes if quoted.
        if (quoted) {
            typeName = typeName.replace('""', '"');
        }

        const typeCode = (dataTypes as { [name: string]: any })[typeName];
        if (typeof typeCode === "number") {
            return { code: typeCode, info: null };
        }

        if (typeName === cqlNames.duration) {
            return { code: dataTypes.custom, info: customTypeNames.duration };
        }

        if (typeName === cqlNames.empty) {
            // Set as custom
            return { code: dataTypes.custom, info: "empty" };
        }

        const udtInfo = await udtResolver(keyspace, typeName);
        if (udtInfo) {
            return {
                code: dataTypes.udt,
                info: udtInfo,
                options: {
                    frozen: frozen,
                },
            };
        }

        throw new TypeError('Not a valid type "' + typeName + '"');
    }

    /**
     * @private
     */
    #parseChildTypes(
        keyspace: string,
        typeNames: Array<string>,
        udtResolver: any,
    ): any {
        return Promise.all(
            typeNames.map((name: string) =>
                this.parseTypeName(
                    keyspace,
                    name.trim(),
                    0,
                    undefined,
                    udtResolver,
                ),
            ),
        );
    }

    /**
     * Parses a Cassandra fully-qualified class name string into data type information
     * @throws {TypeError}
     * @internal
     * @ignore
     */
    parseFqTypeName(
        typeName: string,
        startIndex?: number,
        length?: number,
    ): any {
        let frozen = false;
        let reversed = false;
        startIndex = startIndex || 0;
        let params;
        if (!length) {
            length = typeName.length;
        }
        if (
            length > complexTypeNames.reversed.length &&
            typeName.indexOf(complexTypeNames.reversed) === startIndex
        ) {
            // Remove the reversed token
            startIndex += complexTypeNames.reversed.length + 1;
            length -= complexTypeNames.reversed.length + 2;
            reversed = true;
        }
        if (
            length > complexTypeNames.frozen.length &&
            typeName.indexOf(complexTypeNames.frozen, startIndex) === startIndex
        ) {
            // Remove the frozen token
            startIndex += complexTypeNames.frozen.length + 1;
            length -= complexTypeNames.frozen.length + 2;
            frozen = true;
        }
        const options = {
            frozen: frozen,
            reversed: reversed,
        };
        if (typeName === complexTypeNames.empty) {
            // set as custom
            return {
                code: dataTypes.custom,
                info: "empty",
                options: options,
            };
        }
        // Quick check if its a single type
        if (length <= singleFqTypeNamesLength) {
            if (startIndex > 0) {
                typeName = typeName.substr(startIndex, length);
            }
            const typeCode = (singleTypeNames as { [name: string]: any })[
                typeName
            ];
            if (typeof typeCode === "number") {
                return { code: typeCode, info: null, options: options };
            }
            // special handling for duration
            if (typeName === customTypeNames.duration) {
                return { code: dataTypes.duration, options: options };
            }
            throw new TypeError('Not a valid type "' + typeName + '"');
        }
        if (
            typeName.indexOf(complexTypeNames.list, startIndex) === startIndex
        ) {
            // Its a list
            // org.apache.cassandra.db.marshal.ListType(innerType)
            // move cursor across the name and bypass the parenthesis
            startIndex += complexTypeNames.list.length + 1;
            length -= complexTypeNames.list.length + 2;
            params = parseParams(typeName, startIndex, length);
            if (params.length !== 1) {
                throw new TypeError("Not a valid type " + typeName);
            }
            const info = this.parseFqTypeName(params[0]);
            return {
                code: dataTypes.list,
                info: info,
                options: options,
            };
        }
        if (typeName.indexOf(complexTypeNames.set, startIndex) === startIndex) {
            // Its a set
            // org.apache.cassandra.db.marshal.SetType(innerType)
            // move cursor across the name and bypass the parenthesis
            startIndex += complexTypeNames.set.length + 1;
            length -= complexTypeNames.set.length + 2;
            params = parseParams(typeName, startIndex, length);
            if (params.length !== 1) {
                throw new TypeError("Not a valid type " + typeName);
            }
            const info = this.parseFqTypeName(params[0]);
            return {
                code: dataTypes.set,
                info: info,
                options: options,
            };
        }
        if (typeName.indexOf(complexTypeNames.map, startIndex) === startIndex) {
            // org.apache.cassandra.db.marshal.MapType(keyType,valueType)
            // move cursor across the name and bypass the parenthesis
            startIndex += complexTypeNames.map.length + 1;
            length -= complexTypeNames.map.length + 2;
            params = parseParams(typeName, startIndex, length);
            // It should contain the key and value types
            if (params.length !== 2) {
                throw new TypeError("Not a valid type " + typeName);
            }
            const info1 = this.parseFqTypeName(params[0]);
            const info2 = this.parseFqTypeName(params[1]);
            return {
                code: dataTypes.map,
                info: [info1, info2],
                options: options,
            };
        }
        if (typeName.indexOf(complexTypeNames.udt, startIndex) === startIndex) {
            // move cursor across the name and bypass the parenthesis
            startIndex += complexTypeNames.udt.length + 1;
            length -= complexTypeNames.udt.length + 2;
            const udtType = this.#parseUdtName(typeName, startIndex, length);
            udtType.options = options;
            return udtType;
        }
        if (
            typeName.indexOf(complexTypeNames.tuple, startIndex) === startIndex
        ) {
            // move cursor across the name and bypass the parenthesis
            startIndex += complexTypeNames.tuple.length + 1;
            length -= complexTypeNames.tuple.length + 2;
            params = parseParams(typeName, startIndex, length);
            if (params.length < 1) {
                throw new TypeError("Not a valid type " + typeName);
            }
            const info = params.map((x) => this.parseFqTypeName(x));
            return {
                code: dataTypes.tuple,
                info: info,
                options: options,
            };
        }

        if (
            typeName.indexOf(customTypeNames.vector, startIndex) === startIndex
        ) {
            // It's a vector, so record the subtype and dimension.
            const params = this.parseVectorTypeArgs.bind(this)(
                typeName,
                customTypeNames.vector,
                this.parseFqTypeName,
            );
            params.options = options;
            return params;
        }

        // Assume custom type if cannot be parsed up to this point.
        const info = typeName.substr(startIndex, length);
        return {
            code: dataTypes.custom,
            info: info,
            options: options,
        };
    }

    /**
     * Parses type names with composites
     * @internal
     * @ignore
     */
    parseKeyTypes(typesString: string): any {
        let i = 0;
        let length = typesString.length;
        const isComposite =
            typesString.indexOf(complexTypeNames.composite) === 0;
        if (isComposite) {
            i = complexTypeNames.composite.length + 1;
            length--;
        }
        const types: Array<string> = [];
        let startIndex = i;
        let nested = 0;
        let inCollectionType = false;
        let hasCollections = false;
        // as collection types are not allowed, it is safe to split by ,
        while (++i < length) {
            switch (typesString[i]) {
                case ",":
                    if (nested > 0) {
                        break;
                    }
                    if (inCollectionType) {
                        // remove type id
                        startIndex = typesString.indexOf(":", startIndex) + 1;
                    }
                    types.push(typesString.substring(startIndex, i));
                    startIndex = i + 1;
                    break;
                case "(":
                    if (
                        nested === 0 &&
                        typesString.indexOf(
                            complexTypeNames.collection,
                            startIndex,
                        ) === startIndex
                    ) {
                        inCollectionType = true;
                        hasCollections = true;
                        // skip collection type
                        i++;
                        startIndex = i;
                        break;
                    }
                    nested++;
                    break;
                case ")":
                    if (inCollectionType && nested === 0) {
                        types.push(
                            typesString.substring(
                                typesString.indexOf(":", startIndex) + 1,
                                i,
                            ),
                        );
                        startIndex = i + 1;
                        break;
                    }
                    nested--;
                    break;
            }
        }
        if (startIndex < length) {
            types.push(typesString.substring(startIndex, length));
        }
        return {
            types: types.map((name) => this.parseFqTypeName(name)),
            hasCollections: hasCollections,
            isComposite: isComposite,
        };
    }

    /**
     *
     */
    #parseUdtName(typeName: string, startIndex: number, length: number): any {
        const udtParams = parseParams(typeName, startIndex, length);
        if (udtParams.length < 2) {
            // It should contain at least the keyspace, name of the udt and a type
            throw new TypeError("Not a valid type " + typeName);
        }
        const udtInfo: { keyspace: string; name: string; fields: Array<any> } =
            {
                keyspace: udtParams[0],
                name: utils
                    .allocBufferFromString(udtParams[1], "hex")
                    .toString(),
                fields: [],
            };
        for (let i = 2; i < udtParams.length; i++) {
            const p = udtParams[i];
            const separatorIndex = p.indexOf(":");
            const fieldType = this.parseFqTypeName(
                p,
                separatorIndex + 1,
                p.length - (separatorIndex + 1),
            );
            udtInfo.fields.push({
                name: utils
                    .allocBufferFromString(p.substr(0, separatorIndex), "hex")
                    .toString(),
                type: fieldType,
            });
        }
        return {
            code: dataTypes.udt,
            info: udtInfo,
        };
    }
}

/**
 * Serializes and deserializes to and from a CQL type and a Javascript Type.
 */
class Encoder extends EncoderMembers {
    constructor(protocolVersion: number, options: any) {
        super(options.encoding || utils.emptyObject);
        this.setProtocolVersion(protocolVersion);
        // The encoding functions of composite types are private members of Encoder.
        // Thus, Encoder adds them.
        this.encoders[dataTypes.list] = this.#encodeList;
        this.encoders[dataTypes.set] = this.#encodeSet;
        this.encoders[dataTypes.map] = this.#encodeMap;
        this.encoders[dataTypes.udt] = this.#encodeUdt;
        this.encoders[dataTypes.tuple] = this.#encodeTuple;
        this.encoders[dataTypes.custom] = this.#encodeCustom;
        if (this.encodingOptions.copyBuffer) {
            this.handleBuffer = handleBufferCopy;
        } else {
            this.handleBuffer = handleBufferRef;
        }
    }
    /**
     * Try to guess the Cassandra type to be stored, based on the javascript value type
     * @param value
     * @ignore
     * @internal
     */
    static guessDataType(value: any): any {
        const esTypeName = typeof value;
        if (esTypeName === "number") {
            return { code: dataTypes.double };
        } else if (esTypeName === "string") {
            if (value.length === 36 && uuidRegex.test(value)) {
                return { code: dataTypes.uuid };
            }
            return { code: dataTypes.text };
        } else if (esTypeName === "boolean") {
            return { code: dataTypes.boolean };
        } else if (value instanceof Buffer) {
            return { code: dataTypes.blob };
        } else if (value instanceof Date) {
            return { code: dataTypes.timestamp };
        } else if (value instanceof Long) {
            return { code: dataTypes.bigint };
        } else if (value instanceof Integer) {
            return { code: dataTypes.varint };
        } else if (value instanceof BigDecimal) {
            return { code: dataTypes.decimal };
        } else if (value instanceof types.Uuid) {
            return { code: dataTypes.uuid };
        } else if (value instanceof types.InetAddress) {
            return { code: dataTypes.inet };
        } else if (value instanceof types.Tuple) {
            return { code: dataTypes.tuple };
        } else if (value instanceof types.LocalDate) {
            return { code: dataTypes.date };
        } else if (value instanceof types.LocalTime) {
            return { code: dataTypes.time };
        } else if (value instanceof types.Duration) {
            return {
                code: dataTypes.custom,
                info: customTypeNames.duration,
            };
        }

        // Map JS TypedArrays onto vectors
        else if (value instanceof types.Vector) {
            if (value && value.length > 0) {
                if (value instanceof Float32Array) {
                    return {
                        code: dataTypes.custom,
                        customTypeName: "vector",
                        info: [{ code: dataTypes.float }, value.length],
                    };
                }

                let subtypeColumnInfo: any = null;
                // try to fetch the subtype from the Vector, or else guess
                if (value.subtype) {
                    try {
                        subtypeColumnInfo = dataTypes.getByName(value.subtype);
                    } catch (TypeError) {
                        // ignore
                    }
                }
                if (subtypeColumnInfo == null) {
                    subtypeColumnInfo = this.guessDataType((value as any)[0]);
                }
                if (subtypeColumnInfo != null) {
                    return {
                        code: dataTypes.custom,
                        customTypeName: "vector",
                        info: [subtypeColumnInfo, value.length],
                    };
                }
                throw new TypeError(
                    "Cannot guess subtype from element " + (value as any)[0],
                );
            } else {
                throw new TypeError("Cannot guess subtype of empty vector");
            }
        } else if (Array.isArray(value)) {
            return { code: dataTypes.list };
        } else if (value instanceof DateRange) {
            throwNotSupported("encoding DateRange");
        }

        return null;
    }
    static isTypedArray(arg: any): boolean {
        // The TypedArray superclass isn't available directly so to detect an instance of a TypedArray
        // subclass we have to access the prototype of a concrete instance.  There's nothing magical about
        // Uint8Array here; we could just as easily use any of the other TypedArray subclasses.
        return arg instanceof Object.getPrototypeOf(Uint8Array);
    }
    /**
     * Decodes a whole page of results.
     */
    decodeRows(
        data: Buffer,
        rowsNumber: number,
        columnNames: Array<string>,
        columnTypes: Array<ColumnInfo>,
    ): Array<types.Row> {
        const res: Array<types.Row> = [];
        const reader = new FrameReader(data);

        for (let i = 0; i < rowsNumber; i++) {
            const row = new types.Row(columnNames);
            for (let j = 0; j < columnTypes.length; j++) {
                const cellBuffer = reader.readBytes();
                row[columnNames[j]] = this.decode(cellBuffer, columnTypes[j]);
            }
            res.push(row);
        }
        return res;
    }
    /**
     * Decodes Cassandra bytes into Javascript values.
     * @param buffer Raw buffer to be decoded.
     */
    decode(buffer: Buffer | null, type: ColumnInfo): any {
        if (
            buffer === null ||
            (buffer.length === 0 &&
                !zeroLengthTypesSupported.has(
                    type.code as unknown as types.dataTypes,
                ))
        ) {
            return null;
        }

        const decoder = this.decoders[type.code];

        if (!decoder) {
            throw new Error("Unknown data type: " + type.code);
        }

        return decoder.call(this, buffer, type);
    }
    /**
     * Encodes Javascript types into Buffer according to the Cassandra protocol.
     * @param value The value to be converted.
     * @param typeInfo The type information.
     *
     * It can be either a:
     * - A `String` representing the data type.
     * - A `Number` with one of the values of {@link module:types~dataTypes dataTypes}.
     * - An `Object` containing the `type.code` as one of the values of
     *   {@link module:types~dataTypes dataTypes} and `type.info`.
     * Returns `null` for null values, `undefined` for unset values and buffer for all other values.
     * @throws {TypeError} When there is an encoding error
     */
    encode(value: any, typeInfo?: any): Buffer | null | undefined {
        value = this.#normalizeValue(value);
        // For the internal representation, types.unset becomes undefined.
        // This is only an internal convention. It does not change the meaning of the value provided by the user.
        if (value === types.unset) {
            return undefined;
        }
        if (value === null || value instanceof Buffer) {
            return value;
        }
        const type = this.#resolveType(value, typeInfo);
        const encoder = this.encoders[type.code];
        if (encoder) {
            return writeToNewBuffer(this, encoder, value, type);
        }
        return this.#legacyEncoderFor(type).call(this, value, type);
    }

    /**
     * Encodes a value as one cell of a request frame, `[i32 length][bytes]`,
     * and writes the cell at `offset` in `out`.
     * It takes the same values and type information as {@link encode},
     * and throws the same errors.
     * A null value is written as length -1, and an unset value as length -2.
     * @returns The offset after the cell.
     * @throws {TypeError} When there is an encoding error
     */
    encodeInto(
        out: GrowableBuffer,
        offset: number,
        value: any,
        typeInfo?: any,
    ): number {
        value = this.#normalizeValue(value);
        if (value === types.unset) {
            return Encoder.writeCell(out, offset, undefined);
        }
        return this.#writeValueCell(out, offset, value, typeInfo);
    }

    /**
     * Writes a value as one cell, `[i32 length][bytes]`, at `offset` in `out`.
     * A null value is written as length -1.
     * The caller must normalize the value, and write an unset value itself.
     * @returns The offset after the cell.
     */
    #writeValueCell(
        out: GrowableBuffer,
        offset: number,
        value: any,
        typeInfo: any,
    ): number {
        if (value === null) {
            return Encoder.writeCell(out, offset, null);
        }
        // Make room for the length first: writing the bytes can grow the buffer,
        // and then it keeps only the bytes before their start.
        out.ensure(offset, 4);
        const start = offset + 4;
        const end = this.#writeBytes(out, start, value, typeInfo);
        out.buffer.writeInt32BE(end - start, offset);
        return end;
    }

    /**
     * Writes the bytes of a value that is not null or unset, at `start` in `out`.
     * A Buffer is written as it is.
     * Another value is written by the encoder of its type,
     * or encoded by the encoding function of its type and copied.
     * @returns The offset after the bytes.
     */
    #writeBytes(
        out: GrowableBuffer,
        start: number,
        value: any,
        typeInfo: any,
    ): number {
        if (value instanceof Buffer) {
            out.ensure(start, value.length);
            out.buffer.set(value, start);
            return start + value.length;
        }
        const type = this.#resolveType(value, typeInfo);
        const encoder = this.encoders[type.code];
        if (encoder) {
            return encoder.call(this, out, start, value, type);
        }
        const bytes = this.#legacyEncoderFor(type).call(
            this,
            value,
            type,
        ) as Buffer;
        out.ensure(start, bytes.length);
        out.buffer.set(bytes, start);
        return start + bytes.length;
    }

    /**
     * Writes a field of a UDT or an item of a tuple as one cell, `[i32 length][bytes]`,
     * at `offset` in `out`.
     * In the protocol, a field or an item is a `[bytes]`,
     * not a `[value]` as in {@link encodeInto}.
     * A `[bytes]` has no length for unset: each negative length is null.
     * Thus, an unset field or item is written as null, with length -1.
     * For example, with `useUndefinedAsUnset`, a missing field of a UDT is unset.
     * @returns The offset after the cell.
     */
    #writeFieldCell(
        out: GrowableBuffer,
        offset: number,
        value: any,
        typeInfo: any,
    ): number {
        value = this.#normalizeValue(value);
        return this.#writeValueCell(
            out,
            offset,
            value === types.unset ? null : value,
            typeInfo,
        );
    }

    /**
     * Writes a UDT: each field of the type as a cell, in the order of the type.
     * A missing, null or unset field is written as null.
     * @returns The offset after the UDT.
     */
    #encodeUdt(
        out: GrowableBuffer,
        start: number,
        value: any,
        columnInfo: ColumnInfo,
    ): number {
        const udtInfo = columnInfo.info as UdtInfo;
        checkUdtInfo(udtInfo);
        // The fields are read by name. Thus, a primitive, an array or a Map
        // would give a UDT with every field null.
        if (
            value === null ||
            typeof value !== "object" ||
            Array.isArray(value) ||
            value instanceof Map
        ) {
            throw new TypeError(
                "Not a valid udt value, expected Object obtained " +
                    util.inspect(value),
            );
        }
        const fields = udtInfo.fields;
        let end = start;
        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            end = this.#writeFieldCell(out, end, value[field.name], field.type);
        }
        return end;
    }

    /**
     * Writes a tuple: its items as cells, up to the shorter of the type and the value.
     * A null or unset item is written as null.
     * @returns The offset after the tuple.
     */
    #encodeTuple(
        out: GrowableBuffer,
        start: number,
        value: any,
        columnInfo: ColumnInfo,
    ): number {
        const tupleInfo = columnInfo.info as Array<ColumnInfo>;
        checkTupleInfo(tupleInfo);
        // Accept any object with get() and length, not only a Tuple of this
        // copy of the driver.
        if (
            value === null ||
            typeof value !== "object" ||
            typeof value.get !== "function" ||
            typeof value.length !== "number"
        ) {
            throw new TypeError(
                "Not a valid tuple, expected Tuple obtained " +
                    util.inspect(value),
            );
        }
        const length = Math.min(tupleInfo.length, value.length);
        let end = start;
        for (let i = 0; i < length; i++) {
            end = this.#writeFieldCell(out, end, value.get(i), tupleInfo[i]);
        }
        return end;
    }

    /**
     * Writes a list: the number of items, then each item with its length.
     * An empty list is the count 0.
     * @returns The offset after the list.
     */
    #encodeList(
        out: GrowableBuffer,
        start: number,
        value: any,
        columnInfo: ColumnInfo,
    ): number {
        const subtype = columnInfo.info as ColumnInfo;
        if (!Array.isArray(value)) {
            throw new TypeError(
                "Not a valid list value, expected Array obtained " +
                    util.inspect(value),
            );
        }
        let end = this.#writeCollectionLength(out, start, value.length);
        for (let i = 0; i < value.length; i++) {
            const item = value[i];
            if (item === null || item === undefined || item === types.unset) {
                throw new TypeError(
                    "A collection can't contain null or unset values",
                );
            }
            end = this.#writeItem(out, end, item, subtype);
        }
        return end;
    }

    /**
     * Writes a set, from an array, or from an instance of the `set` encoding option.
     * @returns The offset after the set.
     */
    #encodeSet(
        out: GrowableBuffer,
        start: number,
        value: any,
        columnInfo: ColumnInfo,
    ): number {
        if (
            this.encodingOptions.set &&
            value instanceof this.encodingOptions.set
        ) {
            const arr: Array<any> = [];
            value.forEach(function (x: any) {
                arr.push(x);
            });
            value = arr;
        }
        return this.#encodeList(out, start, value, columnInfo);
    }

    /**
     * Writes a map: the number of entries, then the key and the value of each entry,
     * each with its length. The map is a plain object, or an instance of the
     * `map` encoding option. Of a plain object, it writes only the own properties.
     * @returns The offset after the map.
     */
    #encodeMap(
        out: GrowableBuffer,
        start: number,
        value: any,
        columnInfo: ColumnInfo,
    ): number {
        const subtypes = columnInfo.info as [ColumnInfo, ColumnInfo];
        let keySubtype: ColumnInfo | null = null;
        let valueSubtype: ColumnInfo | null = null;
        // Only null and undefined mean "no subtypes": the Encoder then guesses them.
        if (subtypes !== null && subtypes !== undefined) {
            if (!Array.isArray(subtypes)) {
                throw new TypeError(
                    "Type information not valid, a map type needs the types of its keys and values",
                );
            }
            keySubtype = subtypes[0];
            valueSubtype = subtypes[1];
        }
        // The count comes first, but it is known only after the entries.
        out.ensure(start, this.collectionLengthSize);
        let end = start + this.collectionLengthSize;
        let count = 0;
        const addEntry = (val: any, key: any) => {
            if (
                key === null ||
                typeof key === "undefined" ||
                key === types.unset
            ) {
                throw new TypeError("A map can't contain null or unset keys");
            }
            if (
                val === null ||
                typeof val === "undefined" ||
                val === types.unset
            ) {
                throw new TypeError("A map can't contain null or unset values");
            }
            end = this.#writeItem(out, end, key, keySubtype);
            end = this.#writeItem(out, end, val, valueSubtype);
            count++;
        };
        if (
            this.encodingOptions.map &&
            value instanceof this.encodingOptions.map
        ) {
            // Use Map#forEach() method to iterate
            value.forEach(addEntry);
        } else {
            // Use object
            for (const key in value) {
                if (!Object.prototype.hasOwnProperty.call(value, key)) {
                    continue;
                }
                addEntry(value[key], key);
            }
        }
        this.#writeCollectionLength(out, start, count);
        return end;
    }

    /**
     * Writes a value of a custom type: a vector, or a type in `customEncoders`.
     * @returns The offset after the value.
     */
    #encodeCustom(
        out: GrowableBuffer,
        start: number,
        value: any,
        columnInfo: ColumnInfo,
    ): number {
        if (
            "customTypeName" in columnInfo &&
            columnInfo.customTypeName === "vector"
        ) {
            return this.#encodeVector(out, start, value, columnInfo);
        }

        if (
            typeof columnInfo.info === "string" &&
            columnInfo.info.startsWith(customTypeNames.vector)
        ) {
            const vectorColumnInfo = this.parseFqTypeName(columnInfo.info);
            return this.#encodeVector(out, start, value, vectorColumnInfo);
        }

        const handler = customEncoders[columnInfo.info as string];
        if (handler) {
            const bytes = handler.call(this, value);
            out.ensure(start, bytes.length);
            out.buffer.set(bytes, start);
            return start + bytes.length;
        }
        throw new TypeError(
            "No encoding handler found for type " + util.inspect(columnInfo),
        );
    }

    /**
     * Writes a vector: its elements one after another.
     * An element of a type with a variable size has its length before it, as an unsigned vint.
     * @returns The offset after the vector.
     */
    #encodeVector(
        out: GrowableBuffer,
        start: number,
        value: any,
        params: any,
    ): number {
        checkVectorInfo(params.info);
        if (!(value instanceof Vector)) {
            throw new TypeError(
                "Driver only supports Vector type when encoding a vector",
            );
        }

        const dimension = params.info[1];
        if (value.length !== dimension) {
            throw new TypeError(
                `Expected vector with ${dimension} dimensions, observed size of ${value.length}`,
            );
        }

        const subtype = params.info[0];
        const serializationSize = this.serializationSizeIfFixed(subtype);
        let end = start;
        for (const elem of value) {
            if (elem === null || elem === undefined || elem === types.unset) {
                throw new TypeError(
                    "A vector can't contain null or unset values",
                );
            }
            if (serializationSize !== -1) {
                end = this.#writeBytes(out, end, elem, subtype);
                continue;
            }
            // The length comes before the bytes, and its size depends on the length.
            // Thus, encode the element first.
            const elemBuffer = this.encode(elem, subtype) as Buffer;
            const lengthBuffer = utils.VIntCoding.uvintPack(elemBuffer.length);
            out.ensure(end, lengthBuffer.length + elemBuffer.length);
            out.buffer.set(lengthBuffer, end);
            out.buffer.set(elemBuffer, end + lengthBuffer.length);
            end += lengthBuffer.length + elemBuffer.length;
        }
        return end;
    }

    /**
     * Writes one item of a collection at `offset`: its length, with the size
     * of the protocol version, and then its bytes.
     * The caller checks that the item is not null or unset.
     * @returns The offset after the item.
     */
    #writeItem(
        out: GrowableBuffer,
        offset: number,
        value: any,
        typeInfo: any,
    ): number {
        // Make room for the length first: writing the bytes can grow the buffer,
        // and then it keeps only the bytes before their start.
        const size = this.collectionLengthSize;
        out.ensure(offset, size);
        const start = offset + size;
        const end = this.#writeBytes(out, start, value, typeInfo);
        this.#writeCollectionLength(out, offset, end - start);
        return end;
    }

    /**
     * Writes a length or a count of a collection at `offset`,
     * with the size of the protocol version.
     * @returns The offset after it.
     */
    #writeCollectionLength(
        out: GrowableBuffer,
        offset: number,
        length: number,
    ): number {
        if (this.collectionLengthSize === 4) {
            out.ensure(offset, 4);
            out.buffer.writeInt32BE(length, offset);
            return offset + 4;
        }
        out.ensure(offset, 2);
        out.buffer.writeUInt16BE(length, offset);
        return offset + 2;
    }

    /**
     * Parses the user provided value. This can be:
     * - null, which represents a CQL null value,
     * - types.unset, which represents an unset value,
     * - undefined, which becomes one of the above values, by the options,
     * - a regular value.
     * @returns The value, with undefined replaced.
     * @throws {TypeError} When the value is unset, and the protocol version does not support unset values
     */
    #normalizeValue(value: any): any {
        if (value === undefined) {
            value =
                this.encodingOptions.useUndefinedAsUnset &&
                this.protocolVersion >= 4
                    ? types.unset
                    : null;
        }
        if (
            value === types.unset &&
            !types.protocolVersion.supportsUnset(this.protocolVersion)
        ) {
            throw new TypeError(
                "Unset value can not be used for this version of Cassandra, protocol version: " +
                    this.protocolVersion,
            );
        }
        return value;
    }

    /**
     * Gets the type to encode a regular value with, from the type information,
     * or guessed from the value when there is no type information.
     * @throws {TypeError} When the type information is not valid, or the type cannot be guessed
     */
    #resolveType(value: any, typeInfo: any): any {
        let type: any = null;

        // Only null and undefined mean "no hint". Other falsy values, such as
        // false, 0 or "", are hints too: 0 is the code of custom, and the others are not valid.
        if (typeInfo !== null && typeInfo !== undefined) {
            type = typeFromHint(typeInfo);
        } else {
            // Lets guess
            type = Encoder.guessDataType(value);
            if (!type) {
                throw new TypeError(
                    "Target data type could not be guessed, you should use prepared statements for accurate type mapping. Value: " +
                        util.inspect(value),
                );
            }
        }
        return type;
    }

    /**
     * @throws {Error} When the type is not supported
     */
    #legacyEncoderFor(type: any): (value: any, type: any) => any {
        const encoder = this.legacyEncoders[type.code];
        if (!encoder) {
            throw new Error("Type not supported " + type.code);
        }
        return encoder;
    }

    /**
     * Writes a value that is already encoded as one cell of a request frame,
     * `[i32 length][bytes]`, at `offset` in `out`.
     * `null` is written as length -1, and `undefined` (unset) as length -2.
     * @returns The offset after the cell.
     */
    static writeCell(
        out: GrowableBuffer,
        offset: number,
        bytes: Uint8Array | null | undefined,
    ): number {
        switch (bytes) {
            case null:
                out.ensure(offset, 4);
                out.buffer.writeInt32BE(NULL_CELL_LENGTH, offset);
                return offset + 4;
            case undefined:
                out.ensure(offset, 4);
                out.buffer.writeInt32BE(UNSET_CELL_LENGTH, offset);
                return offset + 4;
            default:
                // Fails to compile if the parameter type gets a member that is not a Uint8Array.
                bytes satisfies Uint8Array;
                out.ensure(offset, 4 + bytes.length);
                out.buffer.writeInt32BE(bytes.length, offset);
                out.buffer.set(bytes, offset + 4);
                return offset + 4 + bytes.length;
        }
    }
}

/**
 * @private
 */
function handleBufferCopy(buffer: Buffer): Buffer {
    if (buffer === null) {
        return buffer;
    }
    return utils.copyBuffer(buffer);
}

/**
 * @private
 */
function handleBufferRef(buffer: Buffer): Buffer {
    return buffer;
}
/**
 * Decodes collection length for protocol v3 and above
 * @param bytes
 * @param offset
 * @private
 */
function decodeCollectionLengthV3(bytes: Buffer, offset: number): number {
    return bytes.readInt32BE(offset);
}
/**
 * Decodes collection length for protocol v2 and below
 * @param bytes
 * @param offset
 * @private
 */
function decodeCollectionLengthV2(bytes: Buffer, offset: number): number {
    return bytes.readUInt16BE(offset);
}

function decodeDuration(bytes: Buffer): types.Duration {
    return types.Duration.fromBuffer(bytes);
}

function encodeDuration(value: any): Buffer {
    if (!(value instanceof types.Duration)) {
        throw new TypeError(
            "Not a valid duration, expected Duration/Buffer obtained " +
                util.inspect(value),
        );
    }
    return value.toBuffer();
}

/**
 * @private
 */
function parseParams(
    value: string,
    startIndex: number,
    length: number,
    open?: string,
    close?: string,
): Array<string> {
    open = open || "(";
    close = close || ")";
    const types: Array<string> = [];
    let paramStart = startIndex;
    let level = 0;
    for (let i = startIndex; i < startIndex + length; i++) {
        const c = value[i];
        if (c === open) {
            level++;
        }
        if (c === close) {
            level--;
        }
        if (level === 0 && c === ",") {
            types.push(value.substr(paramStart, i - paramStart));
            paramStart = i + 1;
        }
    }
    // Add the last one
    types.push(value.substr(paramStart, length - (paramStart - startIndex)));
    return types;
}

/**
 * @private
 */
function concatRoutingKey(
    parts: Array<Buffer>,
    totalLength: number,
): Buffer | null {
    if (totalLength === 0) {
        return null;
    }
    if (parts.length === 1) {
        return parts[0];
    }
    const routingKey = utils.allocBufferUnsafe(totalLength);
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
        const item = parts[i];
        routingKey.writeUInt16BE(item.length, offset);
        offset += 2;
        item.copy(routingKey, offset);
        offset += item.length;
        routingKey[offset] = 0;
        offset++;
    }
    return routingKey;
}

export = Encoder;
