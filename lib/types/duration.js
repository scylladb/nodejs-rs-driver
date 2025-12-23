"use strict";
const Long = require("long");
const util = require("util");
const utils = require("../utils");
const { bigintToLong } = require("../new-utils");

/** @module types */

// Reuse the same buffers that should perform slightly better than built-in buffer pool
const reusableBuffers = {
    months: utils.allocBuffer(9),
    days: utils.allocBuffer(9),
    nanoseconds: utils.allocBuffer(9),
};

const maxInt32 = 0x7fffffff;
const maxInt64 = BigInt("9223372036854775807");
const longOneThousand = Long.fromInt(1000);
const nanosPerMicro = longOneThousand;
const nanosPerMilli = longOneThousand.multiply(nanosPerMicro);
const nanosPerSecond = longOneThousand.multiply(nanosPerMilli);
const nanosPerMinute = Long.fromInt(60).multiply(nanosPerSecond);
const nanosPerHour = Long.fromInt(60).multiply(nanosPerMinute);
const daysPerWeek = 7;
const monthsPerYear = 12;
const standardRegex = /(\d+)(y|mo|w|d|h|s|ms|us|µs|ns|m)/gi;
const iso8601Regex =
    /P((\d+)Y)?((\d+)M)?((\d+)D)?(T((\d+)H)?((\d+)M)?((\d+)S)?)?/;
const iso8601WeekRegex = /P(\d+)W/;
const iso8601AlternateRegex =
    /P(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

/**
 * Represents a duration. A duration stores separately months, days, and seconds due to the fact that the number of
 * days in a month varies, and a day can have 23 or 25 hours if a daylight saving is involved.
 */
class Duration {
    /**
     * @type {Number}
     */
    #months;
    /**
     * @type {Number}
     */
    #days;
    /**
     * @type {BigInt}
     */
    #nanoseconds;
    /**
     * Creates a new instance of {@link Duration}.
     * @param {Number} months The number of months.
     * @param {Number} days The number of days.
     * @param {Number|Long|BigInt} nanoseconds The number of nanoseconds.
     * @constructor
     */
    constructor(months, days, nanoseconds) {
        if (typeof months !== "number") {
            throw new TypeError(
                `Expected months to be a number, got ${typeof months}`,
            );
        }
        if (typeof days !== "number") {
            throw new TypeError(
                `Expected days to be a number, got ${typeof days}`,
            );
        }

        this.#months = months;
        this.#days = days;

        if (typeof nanoseconds === "bigint") {
            this.#nanoseconds = nanoseconds;
        } else if (nanoseconds instanceof Long) {
            this.#nanoseconds = nanoseconds.toBigInt();
        } else if (typeof nanoseconds === "number") {
            this.#nanoseconds = BigInt(nanoseconds);
        } else {
            throw new TypeError(
                `Invalid nanosecond argument type: ${typeof nanoseconds}`,
            );
        }

        if (this.#nanoseconds > maxInt64) {
            throw new TypeError(
                `Nanoseconds value cannot exceed ${maxInt64}, got ${this.#nanoseconds}`,
            );
        }
    }

    equals(other) {
        if (!(other instanceof Duration)) {
            return false;
        }
        return (
            this.months === other.months &&
            this.days === other.days &&
            this.nanoseconds.compare(other.nanoseconds) === 0
        );
    }

    /**
     * Get duration from rust object. Not intended to be exposed in the API
     * @package
     * @param {rust.DurationWrapper} arg
     * @returns {Duration}
     */
    static fromRust(arg) {
        let res = new Duration(arg.months, arg.days, arg.getNanoseconds());
        return res;
    }

    /**
     * Gets the number of months
     * @readonly
     * @type {Number}
     */
    get months() {
        return this.#months;
    }

    set months(_) {
        throw new SyntaxError("Duration months is read-only");
    }

    /**
     * Gets the number of days
     * @readonly
     * @type {Number}
     */
    get days() {
        return this.#days;
    }

    set days(_) {
        throw new SyntaxError("Duration days is read-only");
    }

    /**
     * Gets the number of nanoseconds
     * @readonly
     * @type {Long}
     */
    get nanoseconds() {
        return bigintToLong(this.#nanoseconds);
    }

    set nanoseconds(_) {
        throw new SyntaxError("Duration nanoseconds is read-only");
    }

    /**
     * Serializes the duration and returns the representation of the value in bytes.
     * @returns {Buffer}
     */
    toBuffer() {
        let nanoseconds = bigintToLong(this.#nanoseconds);
        const lengthMonths = utils.VIntCoding.writeVInt(
            Long.fromNumber(this.#months),
            reusableBuffers.months,
        );
        const lengthDays = utils.VIntCoding.writeVInt(
            Long.fromNumber(this.#days),
            reusableBuffers.days,
        );
        const lengthNanoseconds = utils.VIntCoding.writeVInt(
            nanoseconds,
            reusableBuffers.nanoseconds,
        );
        const buffer = utils.allocBufferUnsafe(
            lengthMonths + lengthDays + lengthNanoseconds,
        );
        reusableBuffers.months.copy(buffer, 0, 0, lengthMonths);
        let offset = lengthMonths;
        reusableBuffers.days.copy(buffer, offset, 0, lengthDays);
        offset += lengthDays;
        reusableBuffers.nanoseconds.copy(buffer, offset, 0, lengthNanoseconds);
        return buffer;
    }

    /**
     * Returns the string representation of the value.
     * @return {string}
     */
    toString() {
        let nanoseconds = bigintToLong(this.#nanoseconds);
        let value = "";
        function append(dividend, divisor, unit) {
            if (dividend === 0 || dividend < divisor) {
                return dividend;
            }
            // string concatenation is supposed to be faster than join()
            value += (dividend / divisor).toFixed(0) + unit;
            return dividend % divisor;
        }
        function append64(dividend, divisor, unit) {
            if (dividend.equals(Long.ZERO) || dividend.lessThan(divisor)) {
                return dividend;
            }
            // string concatenation is supposed to be faster than join()
            value += dividend.divide(divisor).toString() + unit;
            return dividend.modulo(divisor);
        }
        if (this.#months < 0 || this.#days < 0 || nanoseconds.isNegative()) {
            value = "-";
        }
        let remainder = append(Math.abs(this.#months), monthsPerYear, "y");
        append(remainder, 1, "mo");
        append(Math.abs(this.#days), 1, "d");

        if (!nanoseconds.equals(Long.ZERO)) {
            const nanos = nanoseconds.isNegative()
                ? nanoseconds.negate()
                : nanoseconds;
            remainder = append64(nanos, nanosPerHour, "h");
            remainder = append64(remainder, nanosPerMinute, "m");
            remainder = append64(remainder, nanosPerSecond, "s");
            remainder = append64(remainder, nanosPerMilli, "ms");
            remainder = append64(remainder, nanosPerMicro, "us");
            append64(remainder, Long.ONE, "ns");
        }
        return value;
    }

    /**
     * Creates a new {@link Duration} instance from the binary representation of the value.
     * @param {Buffer} buffer
     * @returns {Duration}
     */
    static fromBuffer(buffer) {
        const offset = { value: 0 };
        const months = utils.VIntCoding.readVInt(buffer, offset).toNumber();
        const days = utils.VIntCoding.readVInt(buffer, offset).toNumber();
        const nanoseconds = utils.VIntCoding.readVInt(buffer, offset);
        return new Duration(months, days, nanoseconds);
    }

    /**
     * Creates a new {@link Duration} instance from the string representation of the value.
     * @param {String} input
     *
     * Accepted formats:
     *
     * - multiple digits followed by a time unit like: 12h30m where the time unit can be:
     *     - `y`: years
     *     - `mo`: months
     *     - `w`: weeks
     *     - `d`: days
     *     - `h`: hours
     *     - `m`: minutes
     *     - `s`: seconds
     *     - `ms`: milliseconds
     *     - `us` or `µs`: microseconds
     *     - `ns`: nanoseconds
     * - ISO 8601 format:  `P[n]Y[n]M[n]DT[n]H[n]M[n]S or P[n]W`
     * - ISO 8601 alternative format: `P[YYYY]-[MM]-[DD]T[hh]:[mm]:[ss]`
     *
     * Duration can be made negative by adding `-` at the beginning of the input
     * @returns {Duration}
     * @example <caption>From formatted string</caption>
     * let date = fromString("4mo7d20ns");  // 1 month, 7 days, 20 nanoseconds
     * @example <caption>From ISO 8601</caption>
     * let date = fromString("P2DT5M");     // 2 days, 5 minutes
     */
    static fromString(input) {
        const isNegative = input.charAt(0) === "-";
        const source = isNegative ? input.substring(1) : input;
        if (source.charAt(0) === "P") {
            if (source.charAt(source.length - 1) === "W") {
                return parseIso8601WeekFormat(isNegative, source);
            }
            if (source.indexOf("-") > 0) {
                return parseIso8601AlternativeFormat(isNegative, source);
            }
            return parseIso8601Format(isNegative, source);
        }
        return parseStandardFormat(isNegative, source);
    }
}
/**
 * @param {Boolean} isNegative
 * @param {String} source
 * @returns {Duration}
 * @private
 */
function parseStandardFormat(isNegative, source) {
    const builder = new Builder(isNegative);
    standardRegex.lastIndex = 0;
    let matches;
    while ((matches = standardRegex.exec(source)) && matches.length <= 3) {
        builder.add(matches[1], matches[2]);
    }
    return builder.build();
}

/**
 * @param {Boolean} isNegative
 * @param {String} source
 * @returns {Duration}
 * @private
 */
function parseIso8601Format(isNegative, source) {
    const matches = iso8601Regex.exec(source);
    if (!matches || matches[0] !== source) {
        throw new TypeError(
            util.format("Unable to convert '%s' to a duration", source),
        );
    }
    const builder = new Builder(isNegative);
    if (matches[1]) {
        builder.addYears(matches[2]);
    }
    if (matches[3]) {
        builder.addMonths(matches[4]);
    }
    if (matches[5]) {
        builder.addDays(matches[6]);
    }
    if (matches[7]) {
        if (matches[8]) {
            builder.addHours(matches[9]);
        }
        if (matches[10]) {
            builder.addMinutes(matches[11]);
        }
        if (matches[12]) {
            builder.addSeconds(matches[13]);
        }
    }
    return builder.build();
}

/**
 * @param {Boolean} isNegative
 * @param {String} source
 * @returns {Duration}
 * @private
 */
function parseIso8601WeekFormat(isNegative, source) {
    const matches = iso8601WeekRegex.exec(source);
    if (!matches || matches[0] !== source) {
        throw new TypeError(
            util.format("Unable to convert '%s' to a duration", source),
        );
    }
    return new Builder(isNegative).addWeeks(matches[1]).build();
}

/**
 * @param {Boolean} isNegative
 * @param {String} source
 * @returns {Duration}
 * @private
 */
function parseIso8601AlternativeFormat(isNegative, source) {
    const matches = iso8601AlternateRegex.exec(source);
    if (!matches || matches[0] !== source) {
        throw new TypeError(
            util.format("Unable to convert '%s' to a duration", source),
        );
    }
    return new Builder(isNegative)
        .addYears(matches[1])
        .addMonths(matches[2])
        .addDays(matches[3])
        .addHours(matches[4])
        .addMinutes(matches[5])
        .addSeconds(matches[6])
        .build();
}

/**
 * @param {Boolean} isNegative
 * @private
 * @constructor
 */
function Builder(isNegative) {
    this._isNegative = isNegative;
    this._unitIndex = 0;
    this._months = 0;
    this._days = 0;
    this._nanoseconds = Long.ZERO;
    this._addMethods = {
        y: this.addYears,
        mo: this.addMonths,
        w: this.addWeeks,
        d: this.addDays,
        h: this.addHours,
        m: this.addMinutes,
        s: this.addSeconds,
        ms: this.addMillis,
        // µs
        "\u00B5s": this.addMicros,
        us: this.addMicros,
        ns: this.addNanos,
    };
    this._unitByIndex = [
        null,
        "years",
        "months",
        "weeks",
        "days",
        "hours",
        "minutes",
        "seconds",
        "milliseconds",
        "microseconds",
        "nanoseconds",
    ];
}

Builder.prototype._validateOrder = function (unitIndex) {
    if (unitIndex === this._unitIndex) {
        throw new TypeError(
            util.format(
                "Invalid duration. The %s are specified multiple times",
                this._getUnitName(unitIndex),
            ),
        );
    }

    if (unitIndex <= this._unitIndex) {
        throw new TypeError(
            util.format(
                "Invalid duration. The %s should be after %s",
                this._getUnitName(this._unitIndex),
                this._getUnitName(unitIndex),
            ),
        );
    }
    this._unitIndex = unitIndex;
};

/**
 * @param {Number} units
 * @param {Number} monthsPerUnit
 */
Builder.prototype._validateMonths = function (units, monthsPerUnit) {
    this._validate32(
        units,
        (maxInt32 - this._months) / monthsPerUnit,
        "months",
    );
};

/**
 * @param {Number} units
 * @param {Number} daysPerUnit
 */
Builder.prototype._validateDays = function (units, daysPerUnit) {
    this._validate32(units, (maxInt32 - this._days) / daysPerUnit, "days");
};

/**
 * @param {Long} units
 * @param {Long} nanosPerUnit
 */
Builder.prototype._validateNanos = function (units, nanosPerUnit) {
    this._validate64(
        units,
        Long.MAX_VALUE.subtract(this._nanoseconds).divide(nanosPerUnit),
        "nanoseconds",
    );
};

/**
 * @param {Number} units
 * @param {Number} limit
 * @param {String} unitName
 */
Builder.prototype._validate32 = function (units, limit, unitName) {
    if (units > limit) {
        throw new TypeError(
            util.format(
                "Invalid duration. The total number of %s must be less or equal to %s",
                unitName,
                maxInt32,
            ),
        );
    }
};

/**
 * @param {Long} units
 * @param {Long} limit
 * @param {String} unitName
 */
Builder.prototype._validate64 = function (units, limit, unitName) {
    if (units.greaterThan(limit)) {
        throw new TypeError(
            util.format(
                "Invalid duration. The total number of %s must be less or equal to %s",
                unitName,
                Long.MAX_VALUE.toString(),
            ),
        );
    }
};

Builder.prototype._getUnitName = function (unitIndex) {
    const name = this._unitByIndex[+unitIndex];
    if (!name) {
        throw new Error("unknown unit index: " + unitIndex);
    }
    return name;
};

Builder.prototype.add = function (textValue, symbol) {
    const addMethod = this._addMethods[symbol.toLowerCase()];
    if (!addMethod) {
        throw new TypeError(
            util.format("Unknown duration symbol '%s'", symbol),
        );
    }
    return addMethod.call(this, textValue);
};

/**
 * @param {String|Number} years
 * @return {Builder}
 */
Builder.prototype.addYears = function (years) {
    const value = +years;
    this._validateOrder(1);
    this._validateMonths(value, monthsPerYear);
    this._months += value * monthsPerYear;
    return this;
};

/**
 * @param {String|Number} months
 * @return {Builder}
 */
Builder.prototype.addMonths = function (months) {
    const value = +months;
    this._validateOrder(2);
    this._validateMonths(value, 1);
    this._months += value;
    return this;
};

/**
 * @param {String|Number} weeks
 * @return {Builder}
 */
Builder.prototype.addWeeks = function (weeks) {
    const value = +weeks;
    this._validateOrder(3);
    this._validateDays(value, daysPerWeek);
    this._days += value * daysPerWeek;
    return this;
};

/**
 * @param {String|Number} days
 * @return {Builder}
 */
Builder.prototype.addDays = function (days) {
    const value = +days;
    this._validateOrder(4);
    this._validateDays(value, 1);
    this._days += value;
    return this;
};

/**
 * @param {String|Long} hours
 * @return {Builder}
 */
Builder.prototype.addHours = function (hours) {
    const value = typeof hours === "string" ? Long.fromString(hours) : hours;
    this._validateOrder(5);
    this._validateNanos(value, nanosPerHour);
    this._nanoseconds = this._nanoseconds.add(value.multiply(nanosPerHour));
    return this;
};

/**
 * @param {String|Long} minutes
 * @return {Builder}
 */
Builder.prototype.addMinutes = function (minutes) {
    const value =
        typeof minutes === "string" ? Long.fromString(minutes) : minutes;
    this._validateOrder(6);
    this._validateNanos(value, nanosPerMinute);
    this._nanoseconds = this._nanoseconds.add(value.multiply(nanosPerMinute));
    return this;
};

/**
 * @param {String|Long} seconds
 * @return {Builder}
 */
Builder.prototype.addSeconds = function (seconds) {
    const value =
        typeof seconds === "string" ? Long.fromString(seconds) : seconds;
    this._validateOrder(7);
    this._validateNanos(value, nanosPerSecond);
    this._nanoseconds = this._nanoseconds.add(value.multiply(nanosPerSecond));
    return this;
};

/**
 * @param {String|Long} millis
 * @return {Builder}
 */
Builder.prototype.addMillis = function (millis) {
    const value = typeof millis === "string" ? Long.fromString(millis) : millis;
    this._validateOrder(8);
    this._validateNanos(value, nanosPerMilli);
    this._nanoseconds = this._nanoseconds.add(value.multiply(nanosPerMilli));
    return this;
};

/**
 * @param {String|Long} micros
 * @return {Builder}
 */
Builder.prototype.addMicros = function (micros) {
    const value = typeof micros === "string" ? Long.fromString(micros) : micros;
    this._validateOrder(9);
    this._validateNanos(value, nanosPerMicro);
    this._nanoseconds = this._nanoseconds.add(value.multiply(nanosPerMicro));
    return this;
};

/**
 * @param {String|Long} nanos
 * @return {Builder}
 */
Builder.prototype.addNanos = function (nanos) {
    const value = typeof nanos === "string" ? Long.fromString(nanos) : nanos;
    this._validateOrder(10);
    this._validateNanos(value, Long.ONE);
    this._nanoseconds = this._nanoseconds.add(value);
    return this;
};

/** @return {Duration} */
Builder.prototype.build = function () {
    return this._isNegative
        ? new Duration(-this._months, -this._days, this._nanoseconds.negate())
        : new Duration(this._months, this._days, this._nanoseconds);
};

module.exports = Duration;
