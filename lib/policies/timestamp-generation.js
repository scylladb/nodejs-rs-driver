// @ts-nocheck
"use strict";

const util = require("util");
const { Long } = require("../types");
const errors = require("../errors");

/** @module policies/timestampGeneration */

/**
 * Defines the maximum date in milliseconds that can be represented in microseconds using Number ((2 ^ 53) / 1000)
 * @const
 * @private
 */
const _maxSafeNumberDate = 9007199254740;

/**
 * A long representing the value 1000
 * @const
 * @private
 */
const _longOneThousand = Long.fromInt(1000);

/**
 * Generates client-side, microsecond-precision query timestamps.
 *
 * Given that Cassandra uses those timestamps to resolve conflicts, implementations should generate
 * monotonically increasing timestamps for successive invocations of {@link TimestampGenerator.next()}.
 */
class TimestampGenerator {
    /**
     * Creates a new instance of {@link TimestampGenerator}.
     */
    constructor() {}
    /**
     * Returns the next timestamp.
     *
     * Implementors should enforce increasing monotonicity of timestamps, that is,
     * a timestamp returned should always be strictly greater that any previously returned
     * timestamp.
     *
     * Implementors should strive to achieve microsecond precision in the best possible way,
     * which is usually largely dependent on the underlying operating system's capabilities.
     * @param {Client} client The {@link Client} instance to generate timestamps to.
     * @returns {Long|Number|null} the next timestamp (in microseconds). If it's equals to `null`, it won't be
     * sent by the driver, letting the server to generate the timestamp.
     * @abstract
     */
    next(client) {
        throw new Error("next() must be implemented");
    }
}

/**
 * A timestamp generator that guarantees monotonically increasing timestamps and logs warnings when timestamps
 * drift in the future.
 *
 * {@link Date} has millisecond precision and client timestamps require microsecond precision. This generator
 * keeps track of the last generated timestamp, and if the current time is within the same millisecond as the last,
 * it fills the microsecond portion of the new timestamp with the value of an incrementing counter.
 * @extends {TimestampGenerator}
 */
class MonotonicTimestampGenerator extends TimestampGenerator {
    #warningThreshold;
    #minLogInterval;
    #micros;
    #lastDate;
    #lastLogDate;

    /**
     *
     * @param {Number} [warningThreshold] Determines how far in the future timestamps are allowed to drift before a
     * warning is logged, expressed in milliseconds. Default: `1000`.
     * @param {Number} [minLogInterval] In case of multiple log events, it determines the time separation between log
     * events, expressed in milliseconds. Use 0 to disable. Default: `1000`.
     */
    constructor(warningThreshold, minLogInterval) {
        super();
        if (warningThreshold < 0) {
            throw new errors.ArgumentError(
                "warningThreshold can not be lower than 0",
            );
        }
        this.#warningThreshold = warningThreshold || 1000;
        this.#minLogInterval = 1000;
        if (typeof minLogInterval === "number") {
            // A value under 1 will disable logging
            this.#minLogInterval = minLogInterval;
        }
        this.#micros = -1;
        this.#lastDate = 0;
        this.#lastLogDate = 0;
    }
    /**
     * Returns the current time in milliseconds since UNIX epoch
     * @returns {Number}
     */
    getDate() {
        return Date.now();
    }
    next(client) {
        let date = this.getDate();
        let drifted = 0;
        if (date > this.#lastDate) {
            this.#micros = 0;
            this.#lastDate = date;
            return this.#generateMicroseconds();
        }

        if (date < this.#lastDate) {
            drifted = this.#lastDate - date;
            date = this.#lastDate;
        }
        if (++this.#micros === 1000) {
            this.#micros = 0;
            if (date === this.#lastDate) {
                // Move date 1 millisecond into the future
                date++;
                drifted++;
            }
        }
        const lastDate = this.#lastDate;
        this.#lastDate = date;
        const result = this.#generateMicroseconds();
        if (drifted >= this.#warningThreshold) {
            // Avoid logging an unbounded amount of times within a clock-skew event or during an interval when more than 1
            // query is being issued by microsecond
            const currentLogDate = Date.now();
            if (
                this.#minLogInterval > 0 &&
                this.#lastLogDate + this.#minLogInterval <= currentLogDate
            ) {
                const message = util.format(
                    "Timestamp generated using current date was %d milliseconds behind the last generated timestamp (which " +
                        "millisecond portion was %d), the returned value (%s) is being artificially incremented to guarantee " +
                        "monotonicity.",
                    drifted,
                    lastDate,
                    result,
                );
                this.#lastLogDate = currentLogDate;
                client.log("warning", message);
            }
        }
        return result;
    }
    /**
     * @private
     * @returns {Number|Long}
     */
    #generateMicroseconds() {
        if (this.#lastDate < _maxSafeNumberDate) {
            // We are safe until Jun 06 2255, its faster to perform this operations on Number than on Long
            // We hope to have native int64 by then :)
            return this.#lastDate * 1000 + this.#micros;
        }
        return Long.fromNumber(this.#lastDate)
            .multiply(_longOneThousand)
            .add(Long.fromInt(this.#micros));
    }
}

exports.TimestampGenerator = TimestampGenerator;
exports.MonotonicTimestampGenerator = MonotonicTimestampGenerator;
