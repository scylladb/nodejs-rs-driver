"use strict";
const utils = require("../utils");
/** @module types */

const millisecondsPerDay = 86400000;
/**
 * 2^31 days before unix epoch is -5877641-06-23. This is the first day that can be represented by this class.
 */
const dateCenter = Math.pow(2, 31);

const daysInAMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * @param {Number} year
 * @returns {boolean}
 */
function isLeapYear(year) {
    return (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
}

/**
 * A date without a time-zone in the ISO-8601 calendar system, such as 2010-08-05.
 *
 * LocalDate is an immutable object that represents a date, often viewed as year-month-day. For example, the value "1st October 2014" can be stored in a LocalDate.
 *
 * This class does not store or represent a time or time-zone. Instead, it is a description of the date, as used for birthdays.
 * It cannot represent an instant on the time-line without additional information such as an offset or time-zone.
 *
 * Note that this type can represent dates in the range [-5877641-06-23; 5881580-07-17]
 * while the ES5 date type can only represent values in the range of [-271821-04-20; 275760-09-13].
 * In the event that year, month, day parameters do not fall within the ES5 date range an Error will be thrown.
 * If you wish to represent a date outside of this range, pass a single
 * parameter indicating the days since epoch. For example, -1 represents 1969-12-31.
 * @property {Date} date The date representation if falls within a range of an ES5 data type, otherwise an invalid date.
 */
class LocalDate {
    /**
     * @type {Number}
     */
    #year;
    /**
     * @type {Number}
     */
    #month;
    /**
     * @type {Number}
     */
    #day;
    /**
     * @type {Number}
     */
    #value;
    /**
     * @type {Date}
     */
    #date;

    /**
     * Creates a new instance of LocalDate.
     * @param {Number} yearOrDaysSinceEpoch The year or days since epoch. If days since epoch, month and day should not be provided.
     * @param {Number} month Between 1 and 12 inclusive.
     * @param {Number} day Between 1 and the number of days in the given month of the given year.
     */
    constructor(yearOrDaysSinceEpoch, month, day) {
        // implementation detail: internally uses a UTC based date
        if (
            typeof yearOrDaysSinceEpoch === "number" &&
            typeof month === "number" &&
            typeof day === "number"
        ) {
            // First case: year represents a year

            // Use setUTCFullYear as if there is a 2 digit year, Date.UTC() assumes
            // that is the 20th century.
            this.#date = new Date();
            this.#date.setUTCHours(0, 0, 0, 0);
            // We need those checks, as setUTCFullYear does not fail if provided with invalid data.
            if (month < 1 || month > 12 || Math.round(month) != month) {
                throw new Error(
                    `Month should be value between 1 and 12, got ${month}.`,
                );
            }
            if (day < 1 || day > daysInAMonth[month - 1]) {
                throw new Error(
                    `Day should be value between 1 and ${daysInAMonth[month - 1]}, got ${day}.`,
                );
            }
            if (month == 2 && day == 29 && !isLeapYear(yearOrDaysSinceEpoch)) {
                throw new Error(
                    `Day should be value between 1 and 28 (non leap year), got ${day}.`,
                );
            }
            this.#date.setUTCFullYear(yearOrDaysSinceEpoch, month - 1, day);
            if (isNaN(this.date.getTime())) {
                throw new Error(
                    `${yearOrDaysSinceEpoch}-${month}-${day} does not form a valid ES5 date!`,
                );
            }
        } else if (typeof month === "undefined" && typeof day === "undefined") {
            // The second case: first argument represents days since epoch
            if (typeof yearOrDaysSinceEpoch === "number") {
                // in days since epoch.
                if (
                    yearOrDaysSinceEpoch < -2147483648 ||
                    yearOrDaysSinceEpoch > 2147483647
                ) {
                    throw new Error(
                        "You must provide a valid value for days since epoch (-2147483648 <= value <= 2147483647).",
                    );
                }
                this.#date = new Date(
                    yearOrDaysSinceEpoch * millisecondsPerDay,
                );
            }
        }

        if (typeof this.#date === "undefined") {
            throw new Error("You must provide a valid year, month and day");
        }

        this.#value = isNaN(this.date.getTime()) ? yearOrDaysSinceEpoch : null;
        this.#year = this.date.getUTCFullYear();
        this.#month = this.date.getUTCMonth() + 1;
        this.#day = this.date.getUTCDate();
    }

    /**
     * A number representing the year. May return NaN if cannot be represented as a Date.
     * @readonly
     * @type {Number}
     */
    get year() {
        return this.#year;
    }

    set year(_) {
        throw new SyntaxError("LocalDate year is read-only");
    }

    /**
     * A number between 1 and 12 inclusive representing the month.
     * May return NaN if cannot be represented as a Date.
     * @readonly
     * @type {Number}
     */
    get month() {
        return this.#month;
    }

    set month(_) {
        throw new SyntaxError("LocalDate month is read-only");
    }

    /**
     * A number between 1 and the number of days in the given month of the given year (value up to 31).
     * May return NaN if cannot be represented as a Date.
     * @readonly
     * @type {Number}
     */
    get day() {
        return this.#day;
    }

    set day(_) {
        throw new SyntaxError("LocalDate day is read-only");
    }

    /**
     * Date object represent this date.
     * @readonly
     * @type {Date}
     */
    get date() {
        return this.#date;
    }

    set date(_) {
        throw new SyntaxError("LocalDate date is read-only");
    }

    /**
     * If date cannot be represented yet given a valid days since epoch, track it internally.
     * @readonly
     * @deprecated This member is in Datastax documentation, but it seems to not be exposed in the API.
     * Additionally we added a new class member: `value` that always returns days since epoch regardless of the date.
     * @type {Number}
     */
    get _value() {
        return this.#value;
    }

    set _value(_) {
        throw new SyntaxError("LocalDate _value is read-only");
    }

    /**
     * Always valid amount of days since epoch.
     * @readonly
     * @type {Number}
     */
    get value() {
        return this.#value
            ? this.#value
            : Math.floor(this.date.valueOf() / millisecondsPerDay);
    }

    set value(_) {
        throw new SyntaxError("LocalDate value is read-only");
    }

    /**
     * Creates a new instance of LocalDate using the current year, month and day from the system clock in the default time-zone.
     */
    static now() {
        return LocalDate.fromDate(new Date());
    }

    /**
     * Creates a new instance of LocalDate using the current date from the system clock at UTC.
     */
    static utcNow() {
        return new LocalDate(Date.now());
    }

    /**
     * Creates a new instance of LocalDate using the year, month and day from the provided local date time.
     * @param {Date} date
     */
    static fromDate(date) {
        if (isNaN(date.getTime())) {
            throw new TypeError(`Invalid date: ${date}`);
        }
        return new LocalDate(
            date.getFullYear(),
            date.getMonth() + 1,
            date.getDate(),
        );
    }

    /**
     * Creates a new instance of LocalDate using the year, month and day provided in the form: yyyy-mm-dd or
     * days since epoch (i.e. -1 for Dec 31, 1969).
     * @param {String} value
     */
    static fromString(value) {
        const dashCount = (value.match(/-/g) || []).length;
        if (dashCount >= 2) {
            let multiplier = 1;
            if (value[0] === "-") {
                value = value.substring(1);
                multiplier = -1;
            }
            const parts = value.split("-");
            return new LocalDate(
                multiplier * parseInt(parts[0], 10),
                parseInt(parts[1], 10),
                parseInt(parts[2], 10),
            );
        }
        if (value.match(/^-?\d+$/)) {
            // Parse as days since epoch.
            return new LocalDate(parseInt(value, 10));
        }
        throw new Error(`Invalid input '${value}'.`);
    }

    /**
     * Creates a new instance of LocalDate using the bytes representation.
     * @param {Buffer} buffer
     */
    static fromBuffer(buffer) {
        // move to unix epoch: 0.
        return new LocalDate(buffer.readUInt32BE(0) - dateCenter);
    }

    /**
     * Compares this LocalDate with the given one.
     * @param {LocalDate} other date to compare against.
     * @return {number} 0 if they are the same, 1 if the this is greater, and -1
     * if the given one is greater.
     */
    compare(other) {
        const thisValue = isNaN(this.date.getTime())
            ? this._value * millisecondsPerDay
            : this.date.getTime();
        const otherValue = isNaN(other.date.getTime())
            ? other._value * millisecondsPerDay
            : other.date.getTime();
        const diff = thisValue - otherValue;
        if (diff < 0) {
            return -1;
        }
        if (diff > 0) {
            return 1;
        }
        return 0;
    }

    /**
     * Returns true if the value of the LocalDate instance and other are the same
     * @param {LocalDate} other
     * @returns {Boolean}
     */
    equals(other) {
        return other instanceof LocalDate && this.compare(other) === 0;
    }

    inspect() {
        return `${this.constructor.name} : ${this.toString()}`;
    }

    /**
     * Gets the bytes representation of the instance.
     * @returns {Buffer}
     */
    toBuffer() {
        // days since unix epoch
        const daysSinceEpoch = isNaN(this.date.getTime())
            ? this._value
            : Math.floor(this.date.getTime() / millisecondsPerDay);
        const value = daysSinceEpoch + dateCenter;
        const buf = utils.allocBufferUnsafe(4);
        buf.writeUInt32BE(value, 0);
        return buf;
    }

    /**
     * Gets the string representation of the instance in the form: yyyy-mm-dd if
     * the value can be parsed as a Date, otherwise days since epoch.
     * @returns {String}
     */
    toString() {
        let result;
        // if cannot be parsed as date, return days since epoch representation.
        if (isNaN(this.date.getTime())) {
            return this._value.toString();
        }
        if (this.year < 0) {
            result = "-" + fillZeros((this.year * -1).toString(), 4);
        } else {
            result = fillZeros(this.year.toString(), 4);
        }
        result +=
            "-" +
            fillZeros(this.month.toString(), 2) +
            "-" +
            fillZeros(this.day.toString(), 2);
        return result;
    }

    /**
     * Gets the string representation of the instance in the form: yyyy-mm-dd, valid for JSON.
     * @returns {String}
     */
    toJSON() {
        return this.toString();
    }
}

/**
 * @param {String} value
 * @param {Number} amount
 * @private
 */
function fillZeros(value, amount) {
    if (value.length >= amount) {
        return value;
    }
    return utils.stringRepeat("0", amount - value.length) + value;
}

module.exports = LocalDate;
