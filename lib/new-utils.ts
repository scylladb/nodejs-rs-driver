"use strict";
import { ArgumentError } from "./errors";
import { inspect } from "util";
import type { ExecutionOptions } from "../";

import Long = require("long");

/**
 * Internal utility for marking not supported endpoints.
 * @param name
 * @throws {ReferenceError}
 */
function throwNotSupported(name: string): never {
    throw new ReferenceError(`${name} is not supported by our driver`);
}

// maxInt value is based on how does Long split values between internal high and low fields.
const maxInt = BigInt(0x100000000);
const minusOne = BigInt(-1);

/**
 * Converts from bigint provided by napi into Long type.
 * BigInt is the way napi handles values too big for js Number type,
 * while Long is the legacy way the code handles 64-bit integers.
 */
function bigintToLong(from: bigint): Long {
    let lo = from % maxInt;
    let hi = from / maxInt;
    if (lo < 0) hi += minusOne;
    return Long.fromValue({
        low: Number(lo),
        high: Number(hi),
        unsigned: false,
    });
}

/**
 * Ensure the value is one of the accepted numeric types, and convert them to BigInt.
 */
function arbitraryValueToBigInt(value: string | number | Long | bigint): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "string" || typeof value == "number")
        return BigInt(value);
    if (value instanceof Long) return value.toBigInt();

    throw new TypeError(
        "Not a valid BigInt value, obtained " + inspect(value),
    );
}

const minInt32 = -0x80000000;
const maxInt32 = 0x7fffffff;

/**
 * Checks whether the number is a 32 bit signed integer.
 * Throws an error, when a value that cannot be represented as i32 is passed.
 * @param number
 * @param name used in the thrown error
 * @throws {TypeError}
 */
function ensure32SignedInteger(number: number, name: string): void {
    if (!Number.isInteger(number)) {
        throw new TypeError(`${name} was expected to be 32bit integer, but it's not a full integer (${number})`);
    }
    if (number < minInt32) {
        throw new TypeError(
            `${name} was expected to be 32bit integer, but it's smaller than allowed (${number} < ${minInt32})`,
        );
    }
    if (number > maxInt32) {
        throw new TypeError(
            `${name} was expected to be 32bit integer, but it's larger than allowed (${number} > ${maxInt32})`,
        );
    }
}

const minInt64 = -BigInt("0x8000000000000000");
const maxInt64 = BigInt("0x7fffffffffffffff");

/**
 * Checks whether the number is a 64 bit signed integer.
 * Throws an error, when a value that cannot be represented as i64 is passed.
 * @param number
 * @param name used in the thrown error
 * @throws {TypeError}
 */
function ensure64SignedInteger(number: bigint, name: string): void {
    if (number < minInt64) {
        throw new TypeError(
            `${name} was expected to be 64bit integer, but it's smaller than allowed (${number} < ${minInt64})`,
        );
    }
    if (number > maxInt64) {
        throw new TypeError(
            `${name} was expected to be 64bit integer, but it's larger than allowed (${number} > ${maxInt64})`,
        );
    }
}

class PreparedInfo {
    types: unknown[];
    statement: string;
    boundParamNames: string[];

    constructor(types: unknown[], statement: string, boundParamNames: string[]) {
        this.types = types;
        this.statement = statement;
        this.boundParamNames = boundParamNames;
    }
}

/**
 * Returns true when params is a named (object) parameter set rather than an array.
 * @throws {ArgumentError} In case params are of unexpected type
 */
function isNamedParameters(params: unknown[] | object | null | undefined, execOptions: ExecutionOptions): boolean {
    if (params === null || params === undefined || Array.isArray(params)) {
        return false;
    }
    if (!(typeof params == "object")) {
        throw new ArgumentError(
            `Parameters must be either an array, or named object, found: ${typeof params}`,
        );
    }
    if (!execOptions.isPrepared()) {
        // This is only a temporary limitation (see #99).
        throw new ArgumentError(
            "Named parameters for simple statements are not supported, use prepare flag",
        );
    }
    return true;
}

export { throwNotSupported, bigintToLong, arbitraryValueToBigInt, isNamedParameters, ensure32SignedInteger, ensure64SignedInteger, PreparedInfo };
