"use strict";
import Long = require("long");
import utils = require("../utils");
import {
    bigintToLong,
    ensure32SignedInteger,
    ensure64SignedInteger,
} from "../new-utils";

/** @module types */

// Reuse the same buffers that should perform slightly better than built-in buffer pool
const reusableBuffers = {
    months: utils.allocBuffer(9),
    days: utils.allocBuffer(9),
    nanoseconds: utils.allocBuffer(9),
};

const maxInt32 = 0x7fffffff;
const _zero = BigInt(0);
const _one = BigInt(1);
const maxInt64 = BigInt("0x7fffffffffffffff");
const nanosPerMicro = BigInt(1000);
const nanosPerMilli = BigInt(1000) * nanosPerMicro;
const nanosPerSecond = BigInt(1000) * nanosPerMilli;
const nanosPerMinute = BigInt(60) * nanosPerSecond;
const nanosPerHour = BigInt(60) * nanosPerMinute;
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
    #months: number;
    #days: number;
    #nanoseconds: bigint;

    /**
     * Creates a new instance of {@link Duration}.
     * @param months The number of months.
     * @param days The number of days.
     * @param nanoseconds The number of nanoseconds.
     */
    constructor(
        months: number,
        days: number,
        nanoseconds: number | Long | bigint,
    ) {
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

        ensure32SignedInteger(months, "months");
        ensure32SignedInteger(days, "days");

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

        ensure64SignedInteger(this.#nanoseconds, "nanoseconds");
    }

    equals(other: Duration): boolean {
        if (!(other instanceof Duration)) {
            return false;
        }
        return (
            this.months === other.months &&
            this.days === other.days &&
            this.#nanoseconds === other.#nanoseconds
        );
    }

    /**
     * Get duration from rust object. Not intended to be exposed in the API
     * @internal
     * @ignore
     */
    static fromRust(arg: any): Duration {
        const res = new Duration(arg.months, arg.days, arg.getNanoseconds());
        return res;
    }

    /**
     * Gets the number of months
     * @readonly
     */
    get months(): number {
        return this.#months;
    }

    set months(_: number) {
        throw new SyntaxError("Duration months is read-only");
    }

    /**
     * Gets the number of days
     * @readonly
     */
    get days(): number {
        return this.#days;
    }

    set days(_: number) {
        throw new SyntaxError("Duration days is read-only");
    }

    /**
     * Gets the number of nanoseconds
     * @readonly
     */
    get nanoseconds(): Long {
        return bigintToLong(this.#nanoseconds);
    }

    set nanoseconds(_: Long) {
        throw new SyntaxError("Duration nanoseconds is read-only");
    }

    /**
     * Serializes the duration and returns the representation of the value in bytes.
     */
    toBuffer(): Buffer {
        const lengthMonths = utils.VIntCoding.writeVInt(
            BigInt(this.#months),
            reusableBuffers.months,
        );
        const lengthDays = utils.VIntCoding.writeVInt(
            BigInt(this.#days),
            reusableBuffers.days,
        );
        const lengthNanoseconds = utils.VIntCoding.writeVInt(
            this.#nanoseconds,
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
     */
    toString(): string {
        let value = "";
        function append(
            dividend: number,
            divisor: number,
            unit: string,
        ): number {
            if (dividend === 0 || dividend < divisor) {
                return dividend;
            }
            // string concatenation is supposed to be faster than join()
            value += Math.floor(dividend / divisor) + unit;
            return dividend % divisor;
        }
        function append64(
            dividend: bigint,
            divisor: bigint,
            unit: string,
        ): bigint {
            if (dividend === _zero || dividend < divisor) {
                return dividend;
            }
            // string concatenation is supposed to be faster than join()
            value += (dividend / divisor).toString() + unit;
            return dividend % divisor;
        }
        if (this.#months < 0 || this.#days < 0 || this.#nanoseconds < _zero) {
            value = "-";
        }
        let remainder = append(Math.abs(this.#months), monthsPerYear, "y");
        append(remainder, 1, "mo");
        append(Math.abs(this.#days), 1, "d");

        if (this.#nanoseconds !== _zero) {
            const nanos =
                this.#nanoseconds < _zero
                    ? -this.#nanoseconds
                    : this.#nanoseconds;
            let remainder64 = append64(nanos, nanosPerHour, "h");
            remainder64 = append64(remainder64, nanosPerMinute, "m");
            remainder64 = append64(remainder64, nanosPerSecond, "s");
            remainder64 = append64(remainder64, nanosPerMilli, "ms");
            remainder64 = append64(remainder64, nanosPerMicro, "us");
            append64(remainder64, _one, "ns");
        }
        return value;
    }

    /**
     * Creates a new {@link Duration} instance from the binary representation of the value.
     */
    static fromBuffer(buffer: Buffer): Duration {
        const offset = { value: 0 };
        const months = Number(utils.VIntCoding.readVInt(buffer, offset));
        const days = Number(utils.VIntCoding.readVInt(buffer, offset));
        const nanoseconds = utils.VIntCoding.readVInt(buffer, offset);
        return new Duration(months, days, nanoseconds);
    }

    /**
     * Creates a new {@link Duration} instance from the string representation of the value.
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
     * @example <caption>From formatted string</caption>
     * let date = fromString("4mo7d20ns");  // 1 month, 7 days, 20 nanoseconds
     * @example <caption>From ISO 8601</caption>
     * let date = fromString("P2DT5M");     // 2 days, 5 minutes
     */
    static fromString(input: string): Duration {
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
 * @private
 */
function parseStandardFormat(isNegative: boolean, source: string): Duration {
    const builder = new Builder(isNegative);
    standardRegex.lastIndex = 0;
    let matches;
    while ((matches = standardRegex.exec(source)) && matches.length <= 3) {
        builder.add(matches[1], matches[2]);
    }
    return builder.build();
}

/**
 * @private
 */
function parseIso8601Format(isNegative: boolean, source: string): Duration {
    const matches = iso8601Regex.exec(source);
    if (!matches || matches[0] !== source) {
        throw new TypeError(`Unable to convert '${source}' to a duration`);
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
 * @private
 */
function parseIso8601WeekFormat(isNegative: boolean, source: string): Duration {
    const matches = iso8601WeekRegex.exec(source);
    if (!matches || matches[0] !== source) {
        throw new TypeError(`Unable to convert '${source}' to a duration`);
    }
    return new Builder(isNegative).addWeeks(matches[1]).build();
}

/**
 * @private
 */
function parseIso8601AlternativeFormat(
    isNegative: boolean,
    source: string,
): Duration {
    const matches = iso8601AlternateRegex.exec(source);
    if (!matches || matches[0] !== source) {
        throw new TypeError(`Unable to convert '${source}' to a duration`);
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
 * @private
 */
class Builder {
    #isNegative: boolean;
    #unitIndex: number;
    #months: number;
    #days: number;
    #nanoseconds: bigint;
    #addMethods: { [symbol: string]: (value: string | number) => Builder };
    #unitByIndex: Array<string | null>;

    constructor(isNegative: boolean) {
        this.#isNegative = isNegative;
        this.#unitIndex = 0;
        this.#months = 0;
        this.#days = 0;
        this.#nanoseconds = _zero;
        this.#addMethods = {
            y: this.addYears,
            mo: this.addMonths,
            w: this.addWeeks,
            d: this.addDays,
            h: this.addHours,
            m: this.addMinutes,
            s: this.addSeconds,
            ms: this.addMillis,
            // µs
            µs: this.addMicros,
            us: this.addMicros,
            ns: this.addNanos,
        };
        this.#unitByIndex = [
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
    #validateOrder(unitIndex: number): void {
        if (unitIndex === this.#unitIndex) {
            throw new TypeError(
                `Invalid duration. The ${this.#getUnitName(unitIndex)} are specified multiple times`,
            );
        }

        if (unitIndex <= this.#unitIndex) {
            throw new TypeError(
                `Invalid duration. The ${this.#getUnitName(this.#unitIndex)} should be after ${this.#getUnitName(unitIndex)}`,
            );
        }
        this.#unitIndex = unitIndex;
    }
    #validateMonths(units: number, monthsPerUnit: number): void {
        const maxMonths = maxInt32 + (this.#isNegative ? 1 : 0);
        this.#validate32(
            units,
            (maxMonths - this.#months) / monthsPerUnit,
            "months",
        );
    }
    #validateDays(units: number, daysPerUnit: number): void {
        const maxDays = maxInt32 + (this.#isNegative ? 1 : 0);
        this.#validate32(units, (maxDays - this.#days) / daysPerUnit, "days");
    }
    #validateNanos(units: bigint, nanosPerUnit: bigint): void {
        const maxNanos = maxInt64 + (this.#isNegative ? _one : _zero);
        this.#validate64(
            units,
            (maxNanos - this.#nanoseconds) / nanosPerUnit,
            "nanoseconds",
        );
    }
    #validate32(units: number, limit: number, unitName: string): void {
        if (units > limit) {
            throw new TypeError(
                `Invalid duration. The total number of ${unitName} must fit in a 32 bit signed integer.`,
            );
        }
    }
    #validate64(units: bigint, limit: bigint, unitName: string): void {
        if (units > limit) {
            throw new TypeError(
                `Invalid duration. The total number of ${unitName} must fit in a 64 bit signed integer.`,
            );
        }
    }
    #getUnitName(unitIndex: number): string {
        const name = this.#unitByIndex[+unitIndex];
        if (!name) {
            throw new Error("unknown unit index: " + unitIndex);
        }
        return name;
    }
    add(textValue: string, symbol: string): Builder {
        const addMethod = this.#addMethods[symbol.toLowerCase()];
        if (!addMethod) {
            throw new TypeError(`Unknown duration symbol '${symbol}'`);
        }
        return addMethod.call(this, textValue);
    }
    addYears(years: string | number): Builder {
        const value = +years;
        this.#validateOrder(1);
        this.#validateMonths(value, monthsPerYear);
        this.#months += value * monthsPerYear;
        return this;
    }
    addMonths(months: string | number): Builder {
        const value = +months;
        this.#validateOrder(2);
        this.#validateMonths(value, 1);
        this.#months += value;
        return this;
    }
    addWeeks(weeks: string | number): Builder {
        const value = +weeks;
        this.#validateOrder(3);
        this.#validateDays(value, daysPerWeek);
        this.#days += value * daysPerWeek;
        return this;
    }
    addDays(days: string | number): Builder {
        const value = +days;
        this.#validateOrder(4);
        this.#validateDays(value, 1);
        this.#days += value;
        return this;
    }
    addHours(hours: string | number | bigint): Builder {
        const value = BigInt(hours);
        this.#validateOrder(5);
        this.#validateNanos(value, nanosPerHour);
        this.#nanoseconds += value * nanosPerHour;
        return this;
    }
    addMinutes(minutes: string | number | bigint): Builder {
        const value = BigInt(minutes);
        this.#validateOrder(6);
        this.#validateNanos(value, nanosPerMinute);
        this.#nanoseconds += value * nanosPerMinute;
        return this;
    }
    addSeconds(seconds: string | number | bigint): Builder {
        const value = BigInt(seconds);
        this.#validateOrder(7);
        this.#validateNanos(value, nanosPerSecond);
        this.#nanoseconds += value * nanosPerSecond;
        return this;
    }
    addMillis(millis: string | number | bigint): Builder {
        const value = BigInt(millis);
        this.#validateOrder(8);
        this.#validateNanos(value, nanosPerMilli);
        this.#nanoseconds += value * nanosPerMilli;
        return this;
    }
    addMicros(micros: string | number | bigint): Builder {
        const value = BigInt(micros);
        this.#validateOrder(9);
        this.#validateNanos(value, nanosPerMicro);
        this.#nanoseconds += value * nanosPerMicro;
        return this;
    }
    addNanos(nanos: string | number | bigint): Builder {
        const value = BigInt(nanos);
        this.#validateOrder(10);
        this.#validateNanos(value, _one);
        this.#nanoseconds += value;
        return this;
    }
    build(): Duration {
        return this.#isNegative
            ? new Duration(-this.#months, -this.#days, -this.#nanoseconds)
            : new Duration(this.#months, this.#days, this.#nanoseconds);
    }
}

export = Duration;
