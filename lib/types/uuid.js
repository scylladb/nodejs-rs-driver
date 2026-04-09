"use strict";

const utils = require("../utils");
const rust = require("../../index");

/** @module types */

/**
 * Represents an immutable universally unique identifier (UUID). A UUID represents a 128-bit value.
 */
class Uuid {
    /**
     * Used to check if the UUID is in a correct format
     * Source: https://stackoverflow.com/a/6640851
     * Verified also with documentation of UUID library in Rust: https://docs.rs/uuid/latest/uuid/
     */
    static uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    /**
     * @type {Buffer}
    
     */
    #raw;

    /**
     * Creates a new instance of Uuid based on a Buffer
     * @param {Buffer} buffer The 16-length buffer.
     */
    constructor(buffer) {
        if (!buffer || buffer.length !== 16) {
            throw new TypeError(
                "You must provide a buffer containing 16 bytes",
            );
        }
        this.#raw = buffer;
    }

    /**
     * Returns the underlying buffer
     * @readonly
     * @type Buffer
     */
    get buffer() {
        return this.#raw;
    }

    set buffer(_) {
        throw new SyntaxError("UUID buffer is read-only");
    }

    /**
     * Parses a string representation of a Uuid
     * @param {string} value
     * @returns {Uuid}
     */
    static fromString(value) {
        if (typeof value !== "string" || !Uuid.uuidRegex.test(value)) {
            throw new Error(
                "Invalid string representation of Uuid, it should be in the 00000000-0000-0000-0000-000000000000 format",
            );
        }
        return new Uuid(
            utils.allocBufferFromString(value.replace(/-/g, ""), "hex"),
        );
    }

    /**
     * Creates a new random (version 4) Uuid.
     * @param {function} [callback] Optional callback to be invoked with the error as
     * first parameter and the created Uuid as second parameter.
     * @returns {Uuid}
     */
    static random(callback) {
        // While in theory nothing should throw here, there may be some edge cases,
        // where napi layer will thrown an error, which we need to catch and pass to the callback.
        if (callback) {
            try {
                return callback(null, new Uuid(rust.getRandomUuidV4()));
            } catch (err) {
                return callback(err);
            }
        }
        return new Uuid(rust.getRandomUuidV4());
    }

    /**
     * Gets the bytes representation of a Uuid
     * @returns {Buffer}
     */
    getBuffer() {
        return this.buffer;
    }

    /**
     * Compares this object to the specified object.
     * The result is true if and only if the argument is not null, is a UUID object, and contains the same value, bit for bit, as this UUID.
     * @param {Uuid} other The other value to test for equality.
     */
    equals(other) {
        if (!(other instanceof Uuid)) {
            return false;
        }
        return this.buffer.compare(other.getBuffer()) == 0;
    }

    /**
     * Returns a string representation of the value of this Uuid instance.
     * 32 hex separated by hyphens, in the form of 00000000-0000-0000-0000-000000000000.
     * @returns {string}
     */
    toString() {
        // 32 hex representation of the Buffer
        const hexValue = this.buffer.toString("hex");
        return `${hexValue.slice(0, 8)}-${hexValue.slice(8, 12)}-${hexValue.slice(12, 16)}-${hexValue.slice(16, 20)}-${hexValue.slice(20)}`;
    }

    /**
     * Provide the name of the constructor and the string representation
     * @returns {string}
     */
    inspect() {
        return `${this.constructor.name}: ${this.toString()}`;
    }

    /**
     * Returns the string representation.
     * Method used by the native JSON.stringify() to serialize this instance.
     */
    toJSON() {
        return this.toString();
    }

    /**
     * @package
     * @param {Buffer} buffer
     * @returns {Uuid}
     */
    static fromRust(buffer) {
        return new Uuid(buffer);
    }

    /**
     * @package
     * @returns {Buffer}
     */
    getInternal() {
        return this.#raw;
    }
}

module.exports = Uuid;
