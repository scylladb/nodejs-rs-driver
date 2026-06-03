// @ts-nocheck
"use strict";
const crypto = require("crypto");
const Long = require("long");

const Uuid = require("./uuid");
const utils = require("../utils");

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

/**
 * Counter used to generate up to 10000 different timeuuid values with the same Date
 * @private
 * @type {number}
 */
let _ticks = 0;
/**
 * Counter used to generate ticks for the current time
 * @private
 * @type {number}
 */
let _ticksForCurrentTime = 0;
/**
 * Remember the last time when a ticks for the current time so that it can be reset
 * @private
 * @type {number}
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
   * If nodeId and/or clockId portions are not provided, the constructor will generate them using
   * `crypto.randomBytes()`. As it's possible that `crypto.randomBytes()` might block, it's
   * recommended that you use the callback-based version of the static methods `fromDate()` or
   * `now()`in that case.
   *
   * @param {Date} [date] The date for the instance. If not provided, current Date will be used.
   * @param {number} [ticks] A number from 0 to 10000 representing the 100-nanoseconds units for this instance to fill in
   * the information not available in the Date, as Ecmascript Dates have only milliseconds precision.
   * @param {string|Buffer} [nodeId] A 6-length Buffer or string of 6 ascii characters representing the node identifier, ie: 'host01'.
   * @param {string|Buffer} [clockId] A 2-length Buffer or string of 6 ascii characters representing the clock identifier.
   */
  constructor(date, ticks, nodeId, clockId) {
    let buffer;
    // Polymorphism warning:
    // The first argument can be also a Buffer. If that's the case, we just call UUID constructor directly.
    if (date instanceof Buffer) {
      if (date.length !== 16) {
        throw new Error("Buffer for v1 uuid not valid");
      }
      buffer = date;
    } else {
      buffer = generateBuffer(date, ticks, nodeId, clockId);
    }
    super(buffer);
  }

  /**
   * Generates a TimeUuid instance based on the Date provided using random node and clock values.
   * @param {Date} date Date to generate the v1 uuid.
   * @param {number} [ticks] A number from 0 to 10000 representing the 100-nanoseconds units for this instance to fill in
   *  the information not available in the Date, as Ecmascript Dates have only milliseconds precision.
   * @param {string|Buffer} [nodeId] A 6-length Buffer or string of 6 ascii characters representing the node identifier, ie: 'host01'.
   * If not provided, a random nodeId will be generated.
   * @param {string|Buffer} [clockId] A 2-length Buffer or string of 6 ascii characters representing the clock identifier.
   * If not provided a random clockId will be generated.
   * @param {Function} [callback] An optional callback to be invoked with the error as first parameter and the created
   * `TimeUuid` as second parameter. When a callback is provided, the random portions of the
   * `TimeUuid` instance are created asynchronously.
   *
   *  When nodeId and/or clockId portions are not provided, this method will generate them using
   *  `crypto.randomBytes()`. As it's possible that `crypto.randomBytes()` might block, it's
   *  recommended that you use the callback-based version of this method in that case.
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
  static fromDate(date, ticks, nodeId, clockId, callback) {
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

    if (!callback) {
      return new TimeUuid(date, ticks, nodeId, clockId);
    }

    utils.parallel(
      [
        (next) =>
          getOrGenerateRandom(nodeId, 6, (err, buffer) =>
            next(err, (nodeId = buffer)),
          ),
        (next) =>
          getOrGenerateRandom(clockId, 2, (err, buffer) =>
            next(err, (clockId = buffer)),
          ),
      ],
      (err) => {
        if (err) {
          return callback(err);
        }

        let timeUuid;
        try {
          timeUuid = new TimeUuid(date, ticks, nodeId, clockId);
        } catch (e) {
          return callback(e);
        }

        callback(null, timeUuid);
      },
    );
  }

  /**
   * Parses a string representation of a TimeUuid
   * @param {string} value should be in 00000000-0000-0000-0000-000000000000 format
   * @returns {TimeUuid}
   */
  static fromString(value) {
    return new TimeUuid(Uuid.fromString(value).getBuffer());
  }

  /**
   * Returns the smallest possible type 1 uuid with the provided Date.
   * @param {Date} date
   * @param {number} ticks
   * @returns {TimeUuid}
   */
  static min(date, ticks) {
    return new TimeUuid(date, ticks, minNodeId, minClockId);
  }

  /**
   * Returns the biggest possible type 1 uuid with the provided Date.
   * @param {Date} date
   * @param {number} ticks
   * @returns {TimeUuid}
   */
  static max(date, ticks) {
    return new TimeUuid(date, ticks, maxNodeId, maxClockId);
  }

  /**
   * Generates a TimeUuid instance based on the current date using random node and clock values.
   * @param {string|Buffer} [nodeId] A 6-length Buffer or string of 6 ascii characters representing the node identifier, ie: 'host01'.
   * If not provided, a random nodeId will be generated.
   * @param {string|Buffer} [clockId] A 2-length Buffer or string of 6 ascii characters representing the clock identifier.
   * If not provided a random clockId will be generated.
   * @param {Function} [callback] An optional callback to be invoked with the error as first parameter and the created
   * `TimeUuid` as second parameter. When a callback is provided, the random portions of the
   * `TimeUuid` instance are created asynchronously.
   *
   * When nodeId and/or clockId portions are not provided, this method will generate them using
   * `crypto.randomBytes()`. As it's possible that `crypto.randomBytes()` might block, it's
   * recommended that you use the callback-based version of this method in that case.
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
  static now(nodeId, clockId, callback) {
    return TimeUuid.fromDate(null, null, nodeId, clockId, callback);
  }

  /**
   * Gets the Date and 100-nanoseconds units representation of this instance.
   * @returns {{date: Date, ticks: number}}
   */
  getDatePrecision() {
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
   * @returns {Date}
   */
  getDate() {
    return this.getDatePrecision().date;
  }

  /**
   * Returns the node id this instance
   * @returns {Buffer}
   */
  getNodeId() {
    return this.buffer.slice(10);
  }

  /**
   * Returns the clock id this instance, with the variant applied (first 2 msb being 1 and 0).
   * @returns {Buffer}
   */
  getClockId() {
    return this.buffer.slice(8, 10);
  }

  /**
   * Returns the node id this instance as an ascii string
   * @returns {string}
   */
  getNodeIdString() {
    return this.buffer.slice(10).toString("ascii");
  }

  /**
   * @package
   * @param {Buffer} buffer
   * @returns {TimeUuid}
   */
  static fromRust(buffer) {
    return new TimeUuid(buffer);
  }
}

function writeTime(buffer, time, ticks) {
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
 * Returns a buffer of length 2 representing the clock identifier
 * @param {string|Buffer} clockId
 * @returns {Buffer}
 * @private
 */
function getClockId(clockId) {
  let buffer = clockId;
  if (typeof clockId === "string") {
    buffer = utils.allocBufferFromString(clockId, "ascii");
  }
  if (!(buffer instanceof Buffer)) {
    // Generate
    buffer = getRandomBytes(2);
  } else if (buffer.length !== 2) {
    throw new Error("Clock identifier must have 2 bytes");
  }
  return buffer;
}

/**
 * Returns a buffer of length 6 representing the clock identifier
 * @param {string|Buffer} nodeId
 * @returns {Buffer}
 * @private
 */
function getNodeId(nodeId) {
  let buffer = nodeId;
  if (typeof nodeId === "string") {
    buffer = utils.allocBufferFromString(nodeId, "ascii");
  }
  if (!(buffer instanceof Buffer)) {
    // Generate
    buffer = getRandomBytes(6);
  } else if (buffer.length !== 6) {
    throw new Error("Node identifier must have 6 bytes");
  }
  return buffer;
}

/**
 * Returns the ticks portion of a timestamp. If the ticks are not provided an internal counter is used that gets reset at 10000.
 * @private
 * @param {number} [ticks]
 * @returns {number}
 */
function getTicks(ticks) {
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
 * @returns {{time: number, ticks: number}}
 */
function getTimeWithTicks(date, ticks) {
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

function getRandomBytes(length) {
  return crypto.randomBytes(length);
}

function getOrGenerateRandom(id, length, callback) {
  if (id) {
    return callback(null, id);
  }
  crypto.randomBytes(length, callback);
}

/**
 * Generates a 16-length Buffer instance
 * @private
 * @param {Date} date
 * @param {number} ticks
 * @param {string|Buffer} nodeId
 * @param {string|Buffer} clockId
 * @returns {Buffer}
 */
function generateBuffer(date, ticks, nodeId, clockId) {
  const timeWithTicks = getTimeWithTicks(date, ticks);
  nodeId = getNodeId(nodeId);
  clockId = getClockId(clockId);
  const buffer = utils.allocBufferUnsafe(16);
  // Positions 0-7 Timestamp
  writeTime(buffer, timeWithTicks.time, timeWithTicks.ticks);
  // Position 8-9 Clock
  clockId.copy(buffer, 8, 0);
  // Positions 10-15 Node
  nodeId.copy(buffer, 10, 0);
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
  return buffer;
}

module.exports = TimeUuid;
