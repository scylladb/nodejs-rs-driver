"use strict";
const customErrors = require("./errors");
const util = require("util");

const Long = require("long");

/**
 * @param {String} entity
 * @param {String} name
 */
function throwNotSupported(name) {
    throw new ReferenceError(`${name} is not supported by our driver`);
}

const errorTypeMap = {
    ...customErrors,
    Error,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
};

const concatenationMark = "#";

/**
 * A wrapper function to map napi errors to Node.js errors or custom errors.
 * Because NAPI-RS does not support throwing errors different that Error, for example
 * TypeError, RangeError, etc. or custom, driver-specific errors, this function is used
 * to catch the original error and throw a new one with the appropriate type.
 * This should be used to wrap all NAPI-RS functions that may throw errors.
 *
 * @param {Function} fn The original function to be wrapped.
 * @returns {Function} A wrapped function with error handling logic.
 */
function napiErrorHandler(fn) {
    return function (...args) {
        try {
            return fn.apply(this, args);
        } catch (error) {
            // Check if message is of format errorType#errorMessage, if so map it to
            // appropriate error, otherwise throw the original error.
            const [errorType, ...messageParts] =
                error.message.split(concatenationMark);
            const message = messageParts.join(concatenationMark);

            if (errorTypeMap[errorType]) {
                const newError = new errorTypeMap[errorType](message);
                newError.stack = error.stack;
                throw newError;
            }
            throw error;
        }
    };
}

// maxInt value is based on how does Long split values between internal high and low fields.
const maxInt = BigInt(0x100000000);
const minusOne = BigInt(-1);

/**
 * Converts from bigint provided by napi into Long type used by the datastax library
 * BigInt is the way napi handles values too big for js Number type,
 * while Long is the way datastax code handles 64-bit integers.
 * @param {bigint} from
 * @returns {Long}
 */
function bigintToLong(from) {
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
 * Ensure the value is one of the accepted numeric types, and convert them to BigInt
 * @param {string | number | Long | BigInt} value
 */
function arbitraryValueToBigInt(value) {
    if (typeof value === "bigint") return value;
    if (typeof value === "string" || typeof value == "number")
        return BigInt(value);
    if (value instanceof Long) return value.toBigInt();

    throw new TypeError(
        "Not a valid BigInt value, obtained " + util.inspect(value),
    );
}

/**
 * The goal of this functions is to generate (potentially toggle-able in the future) warnings,
 * when someone uses a feature whose behavior has changed compared to the DSx driver.
 * @param {string} message
 */
function changedBehaviorWarning(message) {
    console.warn(
        `Using feature whose behavior has changed compared to the DataStax driver: ${message}`,
    );
}

const minInt32 = -0x80000000;
const maxInt32 = 0x7fffffff;

/**
 * Checks whether the number is a 32 bit signed integer.
 * Throws an error, when a value that cannot be represented as i32 is passed.
 * @param {Number | BigInt} number
 * @param {string} name used in the thrown error
 * @throws {TypeError}
 */
function ensure32SignedInteger(number, name) {
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
 * @param {BigInt} number
 * @param {string} name used in the thrown error
 * @throws {TypeError}
 */
function ensure64SignedInteger(number, name) {
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

exports.throwNotSupported = throwNotSupported;
exports.napiErrorHandler = napiErrorHandler;
exports.throwNotSupported = throwNotSupported;
exports.bigintToLong = bigintToLong;
exports.arbitraryValueToBigInt = arbitraryValueToBigInt;
exports.changedBehaviorWarning = changedBehaviorWarning;
exports.ensure32SignedInteger = ensure32SignedInteger;
exports.ensure64SignedInteger = ensure64SignedInteger;
