"use strict";
import util = require("util");

import errors = require("../errors");
import TimeUuid = require("./time-uuid");
import Uuid = require("./uuid");
import protocolVersion = require("./protocol-version");
import utils = require("../utils");

/** @module types */
/**
 * Long constructor, wrapper of the internal library used: {@link https://github.com/dcodeIO/long.js Long.js}.
 */
import Long = require("long");

/**
 * The `long` library is not augmentable through `declare module`, and its own
 * typings naturally don't know about the statics and prototype methods the
 * driver installs on it below, so they are attached through an untyped view of
 * it. They were not part of the hand-written declarations either.
 */
const longAny = Long as any;

/**
 * Consistency levels
 */
enum consistencies {
    /**
     * Writing: A write must be written to at least one node. If all replica nodes for the given row key are down, the
     * write can still succeed after a hinted handoff has been written. If all replica nodes are down at write time, an
     * ANY write is not readable until the replica nodes for that row have recovered.
     */
    any = 0x00,
    /** Returns a response from the closest replica, as determined by the snitch. */
    one = 0x01,
    /** Returns the most recent data from two of the closest replicas. */
    two = 0x02,
    /** Returns the most recent data from three of the closest replicas. */
    three = 0x03,
    /**
     * Reading: Returns the record with the most recent timestamp after a quorum of replicas has responded regardless of
     * data center. Writing: A write must be written to the commit log and memory table on a quorum of replica nodes.
     */
    quorum = 0x04,
    /**
     * Reading: Returns the record with the most recent timestamp after all replicas have responded. The read operation
     * will fail if a replica does not respond. Writing: A write must be written to the commit log and memory table on
     * all replica nodes in the cluster for that row.
     */
    all = 0x05,
    /**
     * Reading: Returns the record with the most recent timestamp once a quorum of replicas in the current data center
     * as the coordinator node has reported. Writing: A write must be written to the commit log and memory table on a
     * quorum of replica nodes in the same data center as the coordinator node. Avoids latency of inter-data center
     * communication.
     */
    localQuorum = 0x06,
    /**
     * Reading: Returns the record once a quorum of replicas in each data center of the cluster has responded. Writing:
     * Strong consistency. A write must be written to the commit log and memtable on a quorum of replica nodes in all
     * data centers.
     */
    eachQuorum = 0x07,
    /**
     * Achieves linearizable consistency for lightweight transactions by preventing unconditional updates.
     */
    serial = 0x08,
    /**
     * Same as serial but confined to the data center. A write must be written conditionally to the commit log and
     * memtable on a quorum of replica nodes in the same data center.
     */
    localSerial = 0x09,
    /** Similar to One but only within the DC the coordinator is in. */
    localOne = 0x0a,
}

/**
 * Mapping of consistency level codes to their string representation.
 */
const consistencyToString: { [code: number]: string } = {};
consistencyToString[consistencies.any] = "ANY";
consistencyToString[consistencies.one] = "ONE";
consistencyToString[consistencies.two] = "TWO";
consistencyToString[consistencies.three] = "THREE";
consistencyToString[consistencies.quorum] = "QUORUM";
consistencyToString[consistencies.all] = "ALL";
consistencyToString[consistencies.localQuorum] = "LOCAL_QUORUM";
consistencyToString[consistencies.eachQuorum] = "EACH_QUORUM";
consistencyToString[consistencies.serial] = "SERIAL";
consistencyToString[consistencies.localSerial] = "LOCAL_SERIAL";
consistencyToString[consistencies.localOne] = "LOCAL_ONE";

/**
 * Splits the comma separated arguments of a parameterized type name, ignoring
 * the commas that belong to the arguments themselves.
 *
 * @param args Everything between the outermost angle brackets.
 * @returns The arguments, trimmed.
 */
function splitTypeArgs(args: string): Array<string> {
    const result: Array<string> = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < args.length; i++) {
        const char = args[i];
        if (char === "<") {
            depth++;
        } else if (char === ">") {
            depth--;
        } else if (char === "," && depth === 0) {
            result.push(args.substring(start, i).trim());
            start = i + 1;
        }
    }
    result.push(args.substring(start).trim());
    return result;
}

/**
 * CQL data types
 */
enum dataTypes {
    /** A custom type. */
    custom = 0x0000,
    /** ASCII character string. */
    ascii = 0x0001,
    /** 64-bit signed long. */
    bigint = 0x0002,
    /** Arbitrary bytes (no validation). */
    blob = 0x0003,
    /** true or false. */
    boolean = 0x0004,
    /** Counter column (64-bit signed value). */
    counter = 0x0005,
    /** Variable-precision decimal. */
    decimal = 0x0006,
    /** 64-bit IEEE-754 floating point. */
    double = 0x0007,
    /** 32-bit IEEE-754 floating point. */
    float = 0x0008,
    /** 32-bit signed integer. */
    int = 0x0009,
    /** UTF8 encoded string. */
    text = 0x000a,
    /** A timestamp. */
    timestamp = 0x000b,
    /** Type 1 or type 4 UUID. */
    uuid = 0x000c,
    /** UTF8 encoded string. */
    varchar = 0x000d,
    /** Arbitrary-precision integer. */
    varint = 0x000e,
    /** Type 1 UUID. */
    timeuuid = 0x000f,
    /** An IP address. It can be either 4 bytes long (IPv4) or 16 bytes long (IPv6). */
    inet = 0x0010,
    /** A date without a time-zone in the ISO-8601 calendar system. */
    date = 0x0011,
    /** A value representing the time portion of the day. */
    time = 0x0012,
    /** 16-bit two's complement integer. */
    smallint = 0x0013,
    /** 8-bit two's complement integer. */
    tinyint = 0x0014,
    duration = 0x0015,
    /** A collection of elements. */
    list = 0x0020,
    /** Key/value pairs. */
    map = 0x0021,
    /** A collection that contains no duplicate elements. */
    set = 0x0022,
    /** User-defined type. */
    udt = 0x0030,
    /** A sequence of values. */
    tuple = 0x0031,
}

namespace dataTypes {
    /**
     * Returns the typeInfo of a given type name
     */
    export function getByName(name: string): {
        code: number;
        info?: any;
        customTypeName?: string;
    } {
        // The reverse mappings a numeric enum carries are strings, so they are
        // filtered out by the `typeof code !== "number"` check below.
        const codes = dataTypes as unknown as { [name: string]: number };
        name = name.toLowerCase();
        if (name.indexOf("<") > 0) {
            const listMatches = /^(list|set)<(.+)>$/.exec(name);
            if (listMatches) {
                return {
                    code: codes[listMatches[1]],
                    info: getByName(listMatches[2]),
                };
            }
            const mapMatches = /^map<(.+)>$/.exec(name);
            if (mapMatches) {
                const args = splitTypeArgs(mapMatches[1]);
                if (args.length === 2) {
                    const [keyType, valueType] = args;
                    return {
                        code: dataTypes.map,
                        info: [getByName(keyType), getByName(valueType)],
                    };
                }
            }
            const udtMatches = /^(udt)<(.+)>$/.exec(name);
            if (udtMatches) {
                // udt name as raw string
                return { code: codes[udtMatches[1]], info: udtMatches[2] };
            }
            const tupleMatches = /^(tuple)<(.+)>$/.exec(name);
            if (tupleMatches) {
                // tuple info as an array of types
                return {
                    code: codes[tupleMatches[1]],
                    info: splitTypeArgs(tupleMatches[2]).map((x) =>
                        getByName(x),
                    ),
                };
            }
            const vectorMatches = /^vector<(.+)>$/.exec(name);
            if (vectorMatches) {
                const args = splitTypeArgs(vectorMatches[1]);
                const [subtype, dimension] = args;
                if (args.length === 2 && /^\d+$/.test(dimension)) {
                    return {
                        code: dataTypes.custom,
                        customTypeName: "vector",
                        info: [getByName(subtype), parseInt(dimension, 10)],
                    };
                }
            }
        }
        const typeInfo = { code: codes[name] };
        if (typeof typeInfo.code !== "number") {
            throw new TypeError("Data type with name " + name + " not valid");
        }
        return typeInfo;
    }
}

/**
 * Map of Data types by code
 * @internal
 * @private
 */
const _dataTypesByCode: { [code: number]: string } = (function () {
    const result: { [code: number]: string } = {};
    for (const key in dataTypes) {
        if (!Object.prototype.hasOwnProperty.call(dataTypes, key)) {
            continue;
        }
        const val = (dataTypes as { [key: string]: any })[key];
        if (typeof val !== "number") {
            continue;
        }
        result[val] = key;
    }
    return result;
})();

/**
 * Represents the distance of Cassandra node as assigned by a LoadBalancingPolicy relatively to the driver instance.
 */
enum distance {
    /** A local node. */
    local = 0,
    /** A remote node. */
    remote = 1,
    /** A node that is meant to be ignored. */
    ignored = 2,
}

/**
 * Log level values used for the `logLevel` client option and emitted in `'log'` events.
 */
enum logLevels {
    /** Finest-grained diagnostic information (TRACE level events). */
    trace = "trace",
    /** Fine-grained diagnostic information useful during development (DEBUG level events). */
    debug = "debug",
    /** High-level informational messages. */
    info = "info",
    /** Potentially harmful situations (default when logLevel is not set). */
    warning = "warning",
    /** Error conditions. */
    error = "error",
    /** Disables internal driver log forwarding. */
    off = "off",
}

/**
 * Server error codes returned by Cassandra
 */
enum responseErrorCodes {
    /** Something unexpected happened. */
    serverError = 0x0000,
    /** Some client message triggered a protocol violation. */
    protocolError = 0x000a,
    /** Authentication was required and failed. */
    badCredentials = 0x0100,
    /**
     * Raised when coordinator knows there is not enough replicas alive to perform a query with the requested
     * consistency level.
     */
    unavailableException = 0x1000,
    /** The request cannot be processed because the coordinator is overloaded. */
    overloaded = 0x1001,
    /** The request was a read request but the coordinator node is bootstrapping. */
    isBootstrapping = 0x1002,
    /** Error encountered during a truncate request. */
    truncateError = 0x1003,
    /** Timeout encountered on write query on coordinator waiting for response(s) from replicas. */
    writeTimeout = 0x1100,
    /** Timeout encountered on read query on coordinator waitign for response(s) from replicas. */
    readTimeout = 0x1200,
    /** A non-timeout error encountered during a read request. */
    readFailure = 0x1300,
    /** A (user defined) function encountered during execution. */
    functionFailure = 0x1400,
    /** A non-timeout error encountered during a write request. */
    writeFailure = 0x1500,
    /** The submitted query has a syntax error. */
    syntaxError = 0x2000,
    /** The logged user doesn't have the right to perform the query. */
    unauthorized = 0x2100,
    /** The query is syntactically correct but invalid. */
    invalid = 0x2200,
    /** The query is invalid because of some configuration issue. */
    configError = 0x2300,
    /**
     * The query attempted to create a schema element (i.e. keyspace, table) that already exists.
     */
    alreadyExists = 0x2400,
    /**
     * Can be thrown while a prepared statement tries to be executed if the provided statement is not known by the
     * coordinator.
     */
    unprepared = 0x2500,
    clientWriteFailure = 0x8000,
}

/**
 * Unset representation.
 *
 * Use this field if you want to set a parameter to `unset`. Valid for Cassandra 2.2 and above.
 */
const unset = Object.freeze({ unset: true });

/**
 * A long representing the value 1000
 * @private
 */
const _longOneThousand = Long.fromInt(1000);

/**
 * Counter used to generate up to 1000 different timestamp values with the same Date
 * @private
 */
let _timestampTicks = 0;

/**
 * Gets the data type name for a given type definition
 * @ignore
 * @internal
 * @throws {ArgumentError}
 */
function getDataTypeNameByCode(item: any): string {
    if (!item || typeof item.code !== "number") {
        throw new errors.ArgumentError("Invalid signature type definition");
    }
    const typeName = _dataTypesByCode[item.code];
    if (!typeName) {
        throw new errors.ArgumentError(
            util.format("Type with code %d not found", item.code),
        );
    }
    if (!("info" in item) || !item.info) {
        return typeName;
    }
    // special case for vector
    if (
        item.code === dataTypes.custom &&
        "customTypeName" in item &&
        item.customTypeName === "vector"
    ) {
        return (
            "vector<" +
            getDataTypeNameByCode(item.info[0]) +
            ", " +
            item.info[1] +
            ">"
        );
    }
    if (Array.isArray(item.info)) {
        return (
            typeName +
            "<" +
            item.info
                .map(function (t: any) {
                    return getDataTypeNameByCode(t);
                })
                .join(", ") +
            ">"
        );
    }
    if (typeof item.info.code === "number") {
        return typeName + "<" + getDataTypeNameByCode(item.info) + ">";
    }
    if (item.code === dataTypes.udt) {
        return item.info.name;
    }
    return typeName;
}

// classes

/**
 * Represents a frame header that could be used to read from a Buffer or to write to a Buffer
 * @ignore
 */
class FrameHeader {
    version: number;
    flags: number;
    streamId: number;
    opcode: number;
    bodyLength: number;

    constructor(
        version: number,
        flags: number,
        streamId: number,
        opcode: number,
        bodyLength: number,
    ) {
        this.version = version;
        this.flags = flags;
        this.streamId = streamId;
        this.opcode = opcode;
        this.bodyLength = bodyLength;
    }

    /**
     * The length of the header of the frame based on the protocol version
     */
    static size(version: number): number {
        if (protocolVersion.uses2BytesStreamIds(version)) {
            return 9;
        }
        return 8;
    }

    /**
     * Gets the protocol version based on the first byte of the header
     */
    static getProtocolVersion(buffer: Buffer): number {
        return buffer[0] & 0x7f;
    }

    static fromBuffer(buf: Buffer, offset?: number): FrameHeader {
        let streamId;
        if (!offset) {
            offset = 0;
        }
        const version = buf[offset++] & 0x7f;
        const flags = buf.readUInt8(offset++);
        if (!protocolVersion.uses2BytesStreamIds(version)) {
            streamId = buf.readInt8(offset++);
        } else {
            streamId = buf.readInt16BE(offset);
            offset += 2;
        }
        return new FrameHeader(
            version,
            flags,
            streamId,
            buf.readUInt8(offset++),
            buf.readUInt32BE(offset),
        );
    }

    toBuffer(): Buffer {
        const buf = utils.allocBufferUnsafe(FrameHeader.size(this.version));
        buf.writeUInt8(this.version, 0);
        buf.writeUInt8(this.flags, 1);
        let offset = 3;
        if (!protocolVersion.uses2BytesStreamIds(this.version)) {
            buf.writeInt8(this.streamId, 2);
        } else {
            buf.writeInt16BE(this.streamId, 2);
            offset = 4;
        }
        buf.writeUInt8(this.opcode, offset++);
        buf.writeUInt32BE(this.bodyLength, offset);
        return buf;
    }
}

/**
 * Returns a long representation.
 * Used internally for deserialization
 */
longAny.fromBuffer = function (value: Buffer): Long {
    if (!(value instanceof Buffer)) {
        throw new TypeError("Expected Buffer, obtained " + util.inspect(value));
    }
    return new Long(value.readInt32BE(4), value.readInt32BE(0));
};

/**
 * Returns a big-endian buffer representation of the Long instance
 */
longAny.toBuffer = function (value: Long): Buffer {
    if (!(value instanceof Long)) {
        throw new TypeError("Expected Long, obtained " + util.inspect(value));
    }
    const buffer = utils.allocBufferUnsafe(8);
    buffer.writeUInt32BE(value.getHighBitsUnsigned(), 0);
    buffer.writeUInt32BE(value.getLowBitsUnsigned(), 4);
    return buffer;
};

/**
 * Provide the name of the constructor and the string representation
 */
longAny.prototype.inspect = function (this: Long): string {
    return "Long: " + this.toString();
};

/**
 * Returns the string representation.
 * Method used by the native JSON.stringify() to serialize this instance
 */
longAny.prototype.toJSON = function (this: Long): string {
    return this.toString();
};

/**
 * Generates a value representing the timestamp for the query in microseconds based on the date and the microseconds provided
 * @param date The date to generate the value, if not provided it will use the current date.
 * @param microseconds A number from 0 to 999 used to build the microseconds part of the date.
 */
function generateTimestamp(date?: Date, microseconds?: number): Long {
    if (!date) {
        date = new Date();
    }
    let longMicro;
    if (
        typeof microseconds === "number" &&
        microseconds >= 0 &&
        microseconds < 1000
    ) {
        longMicro = Long.fromInt(microseconds);
    } else {
        if (_timestampTicks > 999) {
            _timestampTicks = 0;
        }
        longMicro = Long.fromInt(_timestampTicks);
        _timestampTicks++;
    }
    return Long.fromNumber(date.getTime())
        .multiply(_longOneThousand)
        .add(longMicro);
}

// error classes

/** @private */
class QueryParserError extends errors.DriverError {
    internalError: Error;

    constructor(e: Error) {
        super(e.message);
        this.internalError = e;
    }
}

/** @private */
class TimeoutError extends errors.DriverError {
    constructor(message: string) {
        super(message);
        this.info =
            "Represents an error that happens when the maximum amount of time for an operation passed.";
    }
}

// export DriverError for backward-compatibility
const DriverError = errors.DriverError;

export type BigDecimal = import("./big-decimal");
export const BigDecimal: typeof import("./big-decimal") = require("./big-decimal");
export type Duration = import("./duration");
export const Duration: typeof import("./duration") = require("./duration");
export type InetAddress = import("./inet-address");
export const InetAddress: typeof import("./inet-address") = require("./inet-address");
export type Integer = import("./integer");
export const Integer: typeof import("./integer") = require("./integer");
export type LocalDate = import("./local-date");
export const LocalDate: typeof import("./local-date") = require("./local-date");
export type LocalTime = import("./local-time");
export const LocalTime: typeof import("./local-time") = require("./local-time");
export type ResultSet = import("./result-set");
export const ResultSet: typeof import("./result-set") = require("./result-set");
export type ResultStream = import("./result-stream");
export const ResultStream: typeof import("./result-stream") = require("./result-stream");
export type Row = import("./row");
export const Row: typeof import("./row") = require("./row");
export type Tuple = import("./tuple");
export const Tuple: typeof import("./tuple") = require("./tuple");
export type Vector = import("./vector");
export const Vector: typeof import("./vector") = require("./vector");

export {
    consistencies,
    consistencyToString,
    dataTypes,
    getDataTypeNameByCode,
    distance,
    logLevels,
    protocolVersion,
    responseErrorCodes,
    FrameHeader,
    Long,
    DriverError,
    TimeoutError,
    TimeUuid,
    Uuid,
    unset,
    generateTimestamp,
};
