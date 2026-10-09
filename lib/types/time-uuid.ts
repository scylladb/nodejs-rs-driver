"use strict";
import crypto = require("crypto");
import Long = require("long");

import Uuid = require("./uuid");
import { registerEntropyCacheSnapshotReset } from "./entropy-cache-snapshot";
import utils = require("../utils");
import { ValueCallback } from "../..";

/** @module types */
/**
 * Oct 15, 1582 in milliseconds since unix epoch
 * @const
 * @private
 */
const _unixToGregorian = 12219292800000;
/**
 * 10,000 ticks in a millisecond
 * @const
 * @private
 */
const _ticksInMs = 10000;

const minNodeId = utils.allocBufferFromString("808080808080", "hex");
const minClockId = utils.allocBufferFromString("8080", "hex");
const maxNodeId = utils.allocBufferFromString("7f7f7f7f7f7f", "hex");
const maxClockId = utils.allocBufferFromString("7f7f", "hex");

// Cache entropy for synchronous generation without pointing outputs at the cache.
const timeUuidEntropyCache = Buffer.alloc(128 * 8);
let timeUuidEntropyOffset = timeUuidEntropyCache.length;

registerEntropyCacheSnapshotReset(timeUuidEntropyCache, () => {
    timeUuidEntropyOffset = timeUuidEntropyCache.length;
});

function fillRandomTimeUuidBytes(
    buffer: Buffer,
    offset: number,
    length: number,
): void {
    if (timeUuidEntropyOffset + length > timeUuidEntropyCache.length) {
        crypto.randomFillSync(timeUuidEntropyCache);
        timeUuidEntropyOffset = 0;
    }
    timeUuidEntropyCache.copy(
        buffer,
        offset,
        timeUuidEntropyOffset,
        timeUuidEntropyOffset + length,
    );
    timeUuidEntropyOffset += length;
}

/**
 * Counter used to generate up to 10000 different timeuuid values with the same Date
 * @private
 */
let _ticks = 0;
/**
 * Counter used to generate ticks for the current time
 * @private
 */
let _ticksForCurrentTime = 0;
/**
 * Remember the last time when a ticks for the current time so that it can be reset
 * @private
 */
let _lastTimestamp = 0;

/**
 * Represents an immutable version 1 universally unique identifier (UUID). A UUID represents a 128-bit value.
 * @extends module:types~Uuid
 */
class TimeUuid extends Uuid {
    /**
     * Creates a new instance of Uuid based on the parameters provided according to rfc4122.
     * If any of the arguments is not provided, it will be randomly generated,
     * except for the date that will use the current date.
     *
     * If nodeId and/or clockId portions are not provided, the constructor uses cached random bytes.
     * A cache refill calls `crypto.randomFillSync()` and might block. Use the callback-based version
     * of `fromDate()` or `now()` if blocking is a concern.
     *
     * @param date The date for the instance. If not provided, current Date will be used.
     * @param ticks A number from 0 to 10000 representing the 100-nanoseconds units for this instance to fill in
     * the information not available in the Date, as Ecmascript Dates have only milliseconds precision.
     * @param nodeId A 6-length Buffer or string of 6 ascii characters representing the node identifier, ie: 'host01'.
     * @param clockId A 2-length Buffer or string of 2 ascii characters representing the clock identifier.
     */
    constructor(
        date?: Date | Buffer | null,
        ticks?: number | null,
        nodeId?: string | Buffer | null,
        clockId?: string | Buffer | null,
    ) {
        let buffer;
        // Polymorphism warning:
        // The first argument can be also a Buffer. If that's the case, we just call UUID constructor directly.
        if (date instanceof Buffer) {
            if (date.length !== 16) {
                throw new Error("Buffer for v1 uuid not valid");
            }
            buffer = date;
        } else {
            buffer = generateBuffer(
                date as Date | null | undefined,
                ticks,
                nodeId,
                clockId,
            );
        }
        super(buffer);
    }

    /**
     * Generates a TimeUuid instance based on the Date provided using random node and clock values.
     * @param date Date to generate the v1 uuid.
     * @param ticks A number from 0 to 10000 representing the 100-nanoseconds units for this instance to fill in
     *  the information not available in the Date, as Ecmascript Dates have only milliseconds precision.
     * @param nodeId A 6-length Buffer or string of 6 ascii characters representing the node identifier, ie: 'host01'.
     * If not provided, a random nodeId will be generated.
     * @param clockId A 2-length Buffer or string of 2 ascii characters representing the clock identifier.
     * If not provided a random clockId will be generated.
     * @param callback An optional callback to be invoked with the error as first parameter and the created
     * `TimeUuid` as second parameter. When a callback is provided, the random portions of the
     * `TimeUuid` instance are created asynchronously.
     *
     *  Without a callback, missing nodeId and/or clockId portions use cached random bytes.
     *  A synchronous cache refill might block; use the callback-based version in that case.
     *
     * @example <caption>Generate a TimeUuid from a ECMAScript Date</caption>
     * const timeuuid = TimeUuid.fromDate(new Date());
     * @example <caption>Generate a TimeUuid from a Date with ticks portion</caption>
     * const timeuuid = TimeUuid.fromDate(new Date(), 1203);
     * @example <caption>Generate a TimeUuid from a Date without any random portion</caption>
     * const timeuuid = TimeUuid.fromDate(new Date(), 1203, 'host01', '02');
     * @example <caption>Generate a TimeUuid from a Date with random node and clock identifiers</caption>
     * TimeUuid.fromDate(new Date(), 1203, function (err, timeuuid) {
     *   // do something with the generated timeuuid
     * });
     */
    static fromDate(
        date: Date,
        ticks?: number,
        nodeId?: string | Buffer,
        clockId?: string | Buffer,
    ): TimeUuid;
    static fromDate(
        date: Date,
        ticks: number,
        nodeId: string | Buffer,
        clockId: string | Buffer,
        callback: ValueCallback<TimeUuid>,
    ): void;
    static fromDate(
        date?: Date | null,
        ticks?: number | null | ValueCallback<TimeUuid>,
        nodeId?: string | Buffer | null | ValueCallback<TimeUuid>,
        clockId?: string | Buffer | null | ValueCallback<TimeUuid>,
        callback?: ValueCallback<TimeUuid>,
    ): TimeUuid | void {
        return fromDateInternal(date, ticks, nodeId, clockId, callback);
    }

    /**
     * Parses a string representation of a TimeUuid
     * @param value should be in 00000000-0000-0000-0000-000000000000 format
     */
    static fromString(value: string): TimeUuid {
        return new TimeUuid(Uuid.fromString(value).getBuffer());
    }

    /**
     * Returns the smallest possible type 1 uuid with the provided Date.
     */
    static min(date: Date, ticks: number): TimeUuid {
        return new TimeUuid(date, ticks, minNodeId, minClockId);
    }

    /**
     * Returns the biggest possible type 1 uuid with the provided Date.
     */
    static max(date: Date, ticks: number): TimeUuid {
        return new TimeUuid(date, ticks, maxNodeId, maxClockId);
    }

    /**
     * Generates a TimeUuid instance based on the current date using random node and clock values.
     * @param nodeId A 6-length Buffer or string of 6 ascii characters representing the node identifier, ie: 'host01'.
     * If not provided, a random nodeId will be generated.
     * @param clockId A 2-length Buffer or string of 2 ascii characters representing the clock identifier.
     * If not provided a random clockId will be generated.
     * @param callback An optional callback to be invoked with the error as first parameter and the created
     * `TimeUuid` as second parameter. When a callback is provided, the random portions of the
     * `TimeUuid` instance are created asynchronously.
     *
     * Without a callback, missing nodeId and/or clockId portions use cached random bytes.
     * A synchronous cache refill might block; use the callback-based version in that case.
     *
     * @example <caption>Generate a TimeUuid from a Date without any random portion</caption>
     * const timeuuid = TimeUuid.now('host01', '02');
     * @example <caption>Generate a TimeUuid with random node and clock identifiers</caption>
     * TimeUuid.now(function (err, timeuuid) {
     *   // do something with the generated timeuuid
     * });
     * @example <caption>Generate a TimeUuid based on the current date (might block)</caption>
     * const timeuuid = TimeUuid.now();
     */
    static now(): TimeUuid;
    static now(nodeId: string | Buffer, clockId?: string | Buffer): TimeUuid;
    static now(
        nodeId: string | Buffer,
        clockId: string | Buffer,
        callback: ValueCallback<TimeUuid>,
    ): void;
    static now(callback: ValueCallback<TimeUuid>): void;
    static now(
        nodeId?: string | Buffer | ValueCallback<TimeUuid>,
        clockId?: string | Buffer | ValueCallback<TimeUuid>,
        callback?: ValueCallback<TimeUuid>,
    ): TimeUuid | void {
        return fromDateInternal(null, null, nodeId, clockId, callback);
    }

    /**
     * Gets the Date and 100-nanoseconds units representation of this instance.
     */
    getDatePrecision(): { date: Date; ticks: number } {
        const timeLow = this.buffer.readUInt32BE(0);

        let timeHigh = 0;
        timeHigh |= (this.buffer[4] & 0xff) << 8;
        timeHigh |= this.buffer[5] & 0xff;
        timeHigh |= (this.buffer[6] & 0x0f) << 24;
        timeHigh |= (this.buffer[7] & 0xff) << 16;

        const val = Long.fromBits(timeLow, timeHigh);
        const ticksInMsLong = Long.fromNumber(_ticksInMs);
        const ticks = val.modulo(ticksInMsLong);
        const time = val
            .div(ticksInMsLong)
            .subtract(Long.fromNumber(_unixToGregorian));
        return { date: new Date(time.toNumber()), ticks: ticks.toNumber() };
    }

    /**
     * Gets the Date representation of this instance.
     */
    getDate(): Date {
        return this.getDatePrecision().date;
    }

    /**
     * Returns the node id this instance
     */
    getNodeId(): Buffer {
        return this.buffer.slice(10);
    }

    /**
     * Returns the clock id this instance, with the variant applied (first 2 msb being 1 and 0).
     */
    getClockId(): Buffer {
        return this.buffer.slice(8, 10);
    }

    /**
     * Returns the node id this instance as an ascii string
     */
    getNodeIdString(): string {
        return this.buffer.slice(10).toString("ascii");
    }

    /**
     * @internal
     * @ignore
     */
    static fromRust(buffer: Buffer): TimeUuid {
        return new TimeUuid(buffer);
    }
}

/**
 * The callback of the asynchronous `TimeUuid` factories, as they actually
 * invoke it: with an error and no value, or with no error and the instance.
 * The public overloads use the stricter {@link ValueCallback} that the driver
 * exposes for every other callback-based method.
 * @private
 */
type TimeUuidCallback = (err: Error | null, value?: TimeUuid) => void;

/**
 * Implements the polymorphic argument handling shared by
 * {@link TimeUuid.fromDate} and {@link TimeUuid.now}, which both accept the
 * callback in place of any of the trailing arguments.
 * @private
 */
function fromDateInternal(
    date?: Date | null,
    ticks?: number | null | ValueCallback<TimeUuid>,
    nodeId?: string | Buffer | null | ValueCallback<TimeUuid>,
    clockId?: string | Buffer | null | ValueCallback<TimeUuid>,
    callback?: ValueCallback<TimeUuid>,
): TimeUuid | void {
    if (typeof ticks === "function") {
        callback = ticks;
        ticks = nodeId = clockId = null;
    } else if (typeof nodeId === "function") {
        callback = nodeId;
        nodeId = clockId = null;
    } else if (typeof clockId === "function") {
        callback = clockId;
        clockId = null;
    }

    const resolvedTicks = ticks as number | null | undefined;
    const resolvedNodeId = nodeId as string | Buffer | null | undefined;
    const resolvedClockId = clockId as string | Buffer | null | undefined;

    if (!callback) {
        return new TimeUuid(
            date,
            resolvedTicks,
            resolvedNodeId,
            resolvedClockId,
        );
    }

    const done = callback as unknown as TimeUuidCallback;
    let nodeIdBuffer: Buffer | null;
    let clockIdBuffer: Buffer | null;
    try {
        // The callback API has historically treated empty-string IDs as missing.
        nodeIdBuffer = resolvedNodeId
            ? getProvidedNodeId(resolvedNodeId)
            : null;
        clockIdBuffer = resolvedClockId
            ? getProvidedClockId(resolvedClockId)
            : null;
    } catch (e) {
        // A missing ID makes validation errors asynchronous in the callback API.
        if (!resolvedNodeId || !resolvedClockId) {
            return process.nextTick(() => done(e as Error));
        }
        return done(e as Error);
    }

    const buffer = utils.allocBufferUnsafe(16);
    const finish = (err?: Error | null): void => {
        if (err) return done(err);
        let timeUuid: TimeUuid;
        try {
            // Preserve the callback API's handling of mutable supplied IDs:
            // copy them after asynchronous randomness is ready.
            if (clockIdBuffer) clockIdBuffer.copy(buffer, 8);
            if (nodeIdBuffer) nodeIdBuffer.copy(buffer, 10);
            // The constructor also accepts a Buffer at runtime. Preserve that
            // behavior when fromDate is called with one and a callback.
            if (date instanceof Buffer) {
                timeUuid = new TimeUuid(date);
            } else {
                // For the callback API, take the time after randomness is ready.
                writeTimeAndUuidBits(
                    buffer,
                    getTimeWithTicks(date, resolvedTicks),
                );
                timeUuid = new TimeUuid(buffer);
            }
        } catch (e) {
            return done(e as Error);
        }
        done(null, timeUuid);
    };

    if (nodeIdBuffer && clockIdBuffer) return finish();
    const randomOffset = clockIdBuffer ? 10 : 8;
    const randomLength = clockIdBuffer ? 6 : nodeIdBuffer ? 2 : 8;
    try {
        crypto.randomFill(buffer, randomOffset, randomLength, finish);
    } catch (e) {
        done(e as Error);
    }
}

function writeTime(buffer: Buffer, time: number, ticks: number): void {
    // value time expressed in ticks precision
    const val = Long.fromNumber(time + _unixToGregorian)
        .multiply(Long.fromNumber(10000))
        .add(Long.fromNumber(ticks));
    const timeHigh = val.getHighBitsUnsigned();
    buffer.writeUInt32BE(val.getLowBitsUnsigned(), 0);
    buffer.writeUInt16BE(timeHigh & 0xffff, 4);
    buffer.writeUInt16BE((timeHigh >>> 16) & 0xffff, 6);
}

/**
 * Validates a provided clock identifier, or returns null if it is missing.
 * @private
 */
function getProvidedClockId(clockId?: string | Buffer | null): Buffer | null {
    let buffer: Buffer;
    if (typeof clockId === "string") {
        buffer = utils.allocBufferFromString(clockId, "ascii");
    } else if (!(clockId instanceof Buffer)) {
        return null;
    } else {
        buffer = clockId;
    }
    if (buffer.length !== 2) {
        throw new Error("Clock identifier must have 2 bytes");
    }
    return buffer;
}

/**
 * Validates a provided node identifier, or returns null if it is missing.
 * @private
 */
function getProvidedNodeId(nodeId?: string | Buffer | null): Buffer | null {
    let buffer: Buffer;
    if (typeof nodeId === "string") {
        buffer = utils.allocBufferFromString(nodeId, "ascii");
    } else if (!(nodeId instanceof Buffer)) {
        return null;
    } else {
        buffer = nodeId;
    }
    if (buffer.length !== 6) {
        throw new Error("Node identifier must have 6 bytes");
    }
    return buffer;
}

/**
 * Returns the ticks portion of a timestamp. If the ticks are not provided an internal counter is used that gets reset at 10000.
 * @private
 */
function getTicks(ticks?: number | null): number {
    if (typeof ticks !== "number" || ticks >= _ticksInMs) {
        _ticks++;
        if (_ticks >= _ticksInMs) {
            _ticks = 0;
        }
        ticks = _ticks;
    }
    return ticks;
}

/**
 * Returns an object with the time representation of the date expressed in milliseconds since unix epoch
 * and a ticks property for the 100-nanoseconds precision.
 * @private
 */
function getTimeWithTicks(
    date?: Date | null,
    ticks?: number | null,
): { time: number; ticks: number } {
    if (!(date instanceof Date) || isNaN(date.getTime())) {
        // time with ticks for the current time
        date = new Date();
        const time = date.getTime();
        _ticksForCurrentTime++;
        if (_ticksForCurrentTime > _ticksInMs || time > _lastTimestamp) {
            _ticksForCurrentTime = 0;
            _lastTimestamp = time;
        }
        ticks = _ticksForCurrentTime;
    }
    return {
        time: date.getTime(),
        ticks: getTicks(ticks),
    };
}

/**
 * Generates a 16-length Buffer instance
 * @private
 */
function generateBuffer(
    date?: Date | null,
    ticks?: number | null,
    nodeId?: string | Buffer | null,
    clockId?: string | Buffer | null,
): Buffer {
    const timeWithTicks = getTimeWithTicks(date, ticks);
    const nodeIdBuffer = getProvidedNodeId(nodeId);
    const clockIdBuffer = getProvidedClockId(clockId);
    const buffer = utils.allocBufferUnsafe(16);
    // Clock ID occupies bytes 8-9; node ID occupies bytes 10-15.
    if (clockIdBuffer) clockIdBuffer.copy(buffer, 8);
    if (nodeIdBuffer) nodeIdBuffer.copy(buffer, 10);
    if (!nodeIdBuffer || !clockIdBuffer) {
        const randomOffset = clockIdBuffer ? 10 : 8;
        const randomLength = clockIdBuffer ? 6 : nodeIdBuffer ? 2 : 8;
        fillRandomTimeUuidBytes(buffer, randomOffset, randomLength);
    }
    writeTimeAndUuidBits(buffer, timeWithTicks);
    return buffer;
}

/** Writes the timestamp and sets UUID version/variant bits on a filled buffer.
 * @private
 */
function writeTimeAndUuidBits(
    buffer: Buffer,
    timeWithTicks: { time: number; ticks: number },
): void {
    // Positions 0-7 Timestamp
    writeTime(buffer, timeWithTicks.time, timeWithTicks.ticks);
    // Version Byte: Time based
    // 0001xxxx
    // turn off first 4 bits
    buffer[6] = buffer[6] & 0x0f;
    // turn on fifth bit
    buffer[6] = buffer[6] | 0x10;

    // IETF Variant Byte: 1.0.x
    // 10xxxxxx
    // turn off first 2 bits
    buffer[8] = buffer[8] & 0x3f;
    // turn on first bit
    buffer[8] = buffer[8] | 0x80;
}

export = TimeUuid;
