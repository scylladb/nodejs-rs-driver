"use strict";
const Long = require("long");
const util = require("util");
const utils = require("../utils");
/** @module types */

const maxNanos = Long.fromString("86399999999999");

const nanoSecInSec = Long.fromNumber(1000000000);
const millisInHour = 3600000;
const millisInMin = 60000;
const nanoSecInMillis = Long.fromNumber(1000000);
const millisInDay = 86400000;

/**
 * A time without a time-zone in the ISO-8601 calendar system, such as 10:30:05.
 * LocalTime is an immutable date-time object that represents a time,
 * often viewed as hour-minute-second. Time is represented to nanosecond precision.
 * For example, the value "13:45.30.123456789" can be stored in a LocalTime.
 */
class LocalTime {
    /**
     * @type {Number}
     */
    #hour;
    /**
     * @type {Number}
     */
    #minute;
    /**
     * @type {Number}
     */
    #second;
    /**
     * @type {Number}
     */
    #nanosecond;
    /**
     * Creates a new instance of LocalTime.
     * @param {Long} totalNanoseconds Total nanoseconds since midnight.
     */
    constructor(totalNanoseconds) {
        if (!(totalNanoseconds instanceof Long)) {
            throw new Error(
                "You must specify a Long value as totalNanoseconds",
            );
        }
        if (
            totalNanoseconds.lessThan(Long.ZERO) ||
            totalNanoseconds.greaterThan(maxNanos)
        ) {
            throw new Error("Total nanoseconds out of range");
        }
        this.value = totalNanoseconds;

        /**
         * Gets the hour component of the time represented by the current instance, a number from 0 to 23.
         * @type Number
         */
        this.#hour = this.#getParts()[0];
        /**
         * Gets the minute component of the time represented by the current instance, a number from 0 to 59.
         * @type Number
         */
        this.#minute = this.#getParts()[1];
        /**
         * Gets the second component of the time represented by the current instance, a number from 0 to 59.
         * @type Number
         */
        this.#second = this.#getParts()[2];
        /**
         * Gets the nanoseconds component of the time represented by the current instance, a number from 0 to 999999999.
         * @type Number
         */
        this.#nanosecond = this.#getParts()[3];
    }

    /**
     * Gets the nanoseconds, a number from 0 to 999 999 999.
     * @readonly
     * @type {Number}
     */
    get nanosecond() {
        return this.#nanosecond;
    }

    set nanosecond(_) {
        throw new SyntaxError("LocalTime nanosecond is read-only");
    }

    /**
     * Gets the seconds, a number from 0 to 59.
     * @readonly
     * @type {Number}
     */
    get second() {
        return this.#second;
    }

    set second(_) {
        throw new SyntaxError("LocalTime second is read-only");
    }

    /**
     * Gets the minutes, a number from 0 to 59.
     * @readonly
     * @type {Number}
     */
    get minute() {
        return this.#minute;
    }

    set minute(_) {
        throw new SyntaxError("LocalTime minute is read-only");
    }

    /**
     * Gets the hours, a number from 0 to 24.
     * @readonly
     * @type {Number}
     */
    get hour() {
        return this.#hour;
    }

    set hour(_) {
        throw new SyntaxError("LocalTime hour is read-only");
    }

    /**
     * Parses a string representation and returns a new LocalDate.
     * @param {String} value
     * @returns {LocalTime}
     */
    static fromString(value) {
        if (typeof value !== "string") {
            throw new TypeError(
                `Argument type invalid: ${util.inspect(value)}, expected string type`,
            );
        }
        const parts = value.split(":");
        if (parts.length > 3) {
            throw new TypeError("Invalid value format");
        }

        let hour = parseInt(parts[0], 10);
        let minutes = parseInt(parts[1], 10);
        if (hour < 0 || hour >= 24) {
            throw new TypeError(
                `Invalid hour. Expected value between 0 and 23, got ${hour}`,
            );
        }
        if (minutes < 0 || minutes >= 60) {
            throw new TypeError(
                `Invalid minute. Expected value between 0 and 59, got ${minutes}`,
            );
        }
        let millis = hour * millisInHour + minutes * millisInMin;

        let nanos;
        if (parts.length === 3) {
            const secParts = parts[2].split(".");
            const seconds = parseInt(secParts[0], 10);
            if (seconds < 0 || seconds >= 60) {
                throw new TypeError(
                    `Invalid second. Expected value between 0 and 59, got ${seconds}`,
                );
            }
            millis += seconds * 1000;
            if (secParts.length === 2) {
                nanos = secParts[1];
                if (nanos.length > 9) {
                    throw new TypeError(
                        "Invalid format for local time constructor. Cannot have sub nanosecond precision.",
                    );
                }
                // add zeros at the end
                nanos = nanos + utils.stringRepeat("0", 9 - nanos.length);
            }
        }
        return LocalTime.fromMilliseconds(millis, parseInt(nanos, 10) || 0);
    }

    /**
     * Uses the current local time (in milliseconds) and the nanoseconds to create a new instance of LocalTime
     * @param {Number} [nanoseconds] A Number from 0 to 999,999,999, representing the time nanosecond portion.
     * @returns {LocalTime}
     */
    static now(nanoseconds) {
        return LocalTime.fromDate(new Date(), nanoseconds);
    }

    /**
     * Uses the provided local time (in milliseconds) and the nanoseconds to create a new instance of LocalTime
     * @param {Date} date Local date portion to extract the time passed since midnight.
     * @param {Number} [nanoseconds] A Number from 0 to 999,999,999 representing the nanosecond time portion.
     * @returns {LocalTime}
     */
    static fromDate(date, nanoseconds) {
        if (!(date instanceof Date)) {
            throw new Error("Not a valid date");
        }
        // Use the local representation, only the milliseconds portion
        const millis =
            (date.getTime() + date.getTimezoneOffset() * -millisInMin) %
            millisInDay;
        return LocalTime.fromMilliseconds(millis, nanoseconds);
    }

    /**
     * Uses the provided local time (in milliseconds) and the nanoseconds to create a new instance of LocalTime
     * @param {Number} milliseconds A Number from 0 to 86,399,999.
     * @param {Number} [nanoseconds] A Number from 0 to 999,999,999 representing the time nanosecond portion.
     * @returns {LocalTime}
     */
    static fromMilliseconds(milliseconds, nanoseconds) {
        if (typeof nanoseconds !== "number") {
            nanoseconds = 0;
        }
        if (isNaN(milliseconds) || isNaN(nanoseconds)) {
            throw new TypeError("Cannot create local time from NaN");
        }
        return new LocalTime(
            Long.fromNumber(milliseconds)
                .multiply(nanoSecInMillis)
                .add(Long.fromNumber(nanoseconds)),
        );
    }

    /**
     * Creates a new instance of LocalTime from the bytes representation.
     * @param {Buffer} value
     * @returns {LocalTime}
     */
    static fromBuffer(value) {
        if (!(value instanceof Buffer)) {
            throw new TypeError(
                "Expected Buffer, obtained " + util.inspect(value),
            );
        }
        return new LocalTime(
            new Long(value.readInt32BE(4), value.readInt32BE(0)),
        );
    }

    /**
     * Compares this LocalTime with the given one.
     * @param {LocalTime} other time to compare against.
     * @return {number} 0 if they are the same, 1 if the this is greater, and -1
     * if the given one is greater.
     */
    compare(other) {
        return this.value.compare(other.value);
    }

    /**
     * Returns true if the value of the LocalTime instance and other are the same
     * @param {LocalTime} other
     * @returns {Boolean}
     */
    equals(other) {
        return other instanceof LocalTime && this.compare(other) === 0;
    }

    /**
     * Gets the total amount of nanoseconds since midnight for this instance.
     * @returns {Long}
     */
    getTotalNanoseconds() {
        return this.value;
    }

    inspect() {
        return `${this.constructor.name}: ${this.toString()}`;
    }

    /**
     * Returns a big-endian bytes representation of the instance
     * @returns {Buffer}
     */
    toBuffer() {
        const buffer = utils.allocBufferUnsafe(8);
        buffer.writeUInt32BE(this.value.getHighBitsUnsigned(), 0);
        buffer.writeUInt32BE(this.value.getLowBitsUnsigned(), 4);
        return buffer;
    }

    /**
     * Returns the string representation of the instance in the form of hh:MM:ss.ns
     * @returns {String}
     */
    toString() {
        return formatTime(this.#getParts());
    }

    /**
     * Gets the string representation of the instance in the form: hh:MM:ss.ns
     * @returns {String}
     */
    toJSON() {
        return this.toString();
    }

    /**
     * @returns {Array.<Number>}
     * @ignore
     */
    #getParts() {
        if (!this._partsCache) {
            // hours, minutes, seconds and nanos
            const parts = [0, 0, 0, 0];
            const secs = this.value.div(nanoSecInSec);
            // faster modulo
            // total nanos
            parts[3] = this.value
                .subtract(secs.multiply(nanoSecInSec))
                .toNumber();
            // seconds
            parts[2] = secs.toNumber();
            if (parts[2] >= 60) {
                // minutes
                parts[1] = Math.floor(parts[2] / 60);
                parts[2] = parts[2] % 60;
            }
            if (parts[1] >= 60) {
                // hours
                parts[0] = Math.floor(parts[1] / 60);
                parts[1] = parts[1] % 60;
            }
            this._partsCache = parts;
        }
        return this._partsCache;
    }
}

/**
 * @param {Array.<Number>} values
 * @private
 */
function formatTime(values) {
    let result;
    if (values[0] < 10) {
        result = "0" + values[0] + ":";
    } else {
        result = values[0] + ":";
    }
    if (values[1] < 10) {
        result += "0" + values[1] + ":";
    } else {
        result += values[1] + ":";
    }
    if (values[2] < 10) {
        result += "0" + values[2];
    } else {
        result += values[2];
    }
    if (values[3] > 0) {
        let nanos = values[3].toString();
        // nine digits
        if (nanos.length < 9) {
            nanos = utils.stringRepeat("0", 9 - nanos.length) + nanos;
        }
        let lastPosition;
        for (let i = nanos.length - 1; i > 0; i--) {
            if (nanos[i] !== "0") {
                break;
            }
            lastPosition = i;
        }
        if (lastPosition) {
            nanos = nanos.substring(0, lastPosition);
        }
        result += "." + nanos;
    }
    return result;
}

module.exports = LocalTime;
