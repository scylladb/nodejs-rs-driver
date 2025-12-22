"use strict";

const utils = require("../utils");

/** @module types */

/**
 * Represents an IP address.
 */
class InetAddress {
    /**
     * @type {Buffer}
     */
    #buffer;
    /**
     * @type {Number}
     */
    #length;
    /**
     * @type {Number}
     */
    #version;
    /**
     * Creates an instance of InetAddress.
     *
     * @param {Buffer} buffer The buffer containing the IPv4 or IPv6 address.
     * @throws {Error} If the buffer is not a valid IPv4 or IPv6 address.
     */
    constructor(buffer) {
        if (
            !(buffer instanceof Buffer) ||
            (buffer.length !== 4 && buffer.length !== 16)
        ) {
            throw new TypeError("The ip address must contain 4 or 16 bytes");
        }

        this.#buffer = buffer;
        this.#length = buffer.length;
        this.#version = buffer.length === 4 ? 4 : 6;
    }

    /**
     * Returns the length of the underlying buffer
     * @readonly
     * @type {Number}
     */
    get length() {
        return this.#length;
    }

    set length(_) {
        throw new SyntaxError("InetAddress length is read-only");
    }

    /**
     * Returns the Ip version (4 or 6)
     * @readonly
     * @type {Number}
     */
    get version() {
        return this.#version;
    }

    set version(_) {
        throw new SyntaxError("InetAddress version is read-only");
    }

    /**
     * Immutable buffer that represents the IP address
     * @readonly
     * @type {Array}
     */
    get buffer() {
        return this.#buffer;
    }

    set buffer(_) {
        throw new SyntaxError("InetAddress buffer is read-only");
    }

    /**
     * Converts a string representation of an IP address to an InetAddress instance.
     *
     * This function accepts both IPv4 and IPv6 addresses, which may include
     * an embedded IPv4 address.
     *
     * @param {string} value
     * @returns {InetAddress}
     * @throws {TypeError} - If the input string is not a valid IPv4 or IPv6 address.
     */
    static fromString(value) {
        if (!value) {
            return new InetAddress(utils.allocBufferFromArray([0, 0, 0, 0]));
        }
        // IPv4 pattern from https://stackoverflow.com/questions/5284147/validating-ipv4-addresses-with-regexp
        const ipv4Pattern = /^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/;
        const ipv6Pattern = /^[\da-f:.]+$/i;
        let parts;
        if (ipv4Pattern.test(value)) {
            parts = value.split(".");
            return new InetAddress(utils.allocBufferFromArray(parts));
        }
        if (!ipv6Pattern.test(value)) {
            throw new TypeError(
                `Value could not be parsed as InetAddress: ${value}`,
            );
        }
        parts = value.split(":");
        if (parts.length < 3) {
            throw new TypeError(
                `Value could not be parsed as InetAddress: ${value}`,
            );
        }
        const buffer = utils.allocBufferUnsafe(16);
        let filling = 8 - parts.length + 1;
        let applied = false;
        let offset = 0;
        const embeddedIp4 = ipv4Pattern.test(parts[parts.length - 1]);
        if (embeddedIp4) {
            // Its IPv6 address with an embedded IPv4 address:
            // subtract 1 from the potential empty filling as ip4 contains 4 bytes instead of 2 of a ipv6 section
            filling -= 1;
        }
        function writeItem(uIntValue) {
            buffer.writeUInt8(+uIntValue, offset++);
        }
        for (let i = 0; i < parts.length; i++) {
            const item = parts[i];
            if (item) {
                if (embeddedIp4 && i === parts.length - 1) {
                    item.split(".").forEach(writeItem);
                    break;
                }
                buffer.writeUInt16BE(parseInt(item, 16), offset);
                offset = offset + 2;
                continue;
            }
            // its an empty string
            if (applied) {
                // there could be 2 occurrences of empty string
                filling = 1;
            }
            applied = true;
            for (let j = 0; j < filling; j++) {
                buffer[offset++] = 0;
                buffer[offset++] = 0;
            }
        }
        if (embeddedIp4 && !InetAddress.#isValidIPv4Mapped(buffer)) {
            throw new TypeError(
                "Only IPv4-Mapped IPv6 addresses are allowed as IPv6 address with embedded IPv4 address",
            );
        }
        return new InetAddress(buffer);
    }

    /**
     * Compares 2 addresses and returns true if the underlying bytes are the same
     * @param {InetAddress} other
     * @returns {Boolean}
     */
    equals(other) {
        if (!(other instanceof InetAddress)) {
            return false;
        }
        return (
            this.buffer.length === other.buffer.length &&
            this.buffer.equals(other.buffer)
        );
    }

    /**
     * Returns the underlying buffer
     * @returns {Buffer}
     */
    getBuffer() {
        return this.buffer;
    }

    /**
     * Provide the name of the constructor and the string representation
     * @returns {string}
     */
    inspect() {
        return `${this.constructor.name}: ${this.toString()}`;
    }

    /**
     * Returns the string representation of the IP address.
     *
     * For v4 IP addresses, a string in the form of d.d.d.d is returned.
     *
     * For v6 IP addresses, a string in the form of x:x:x:x:x:x:x:x is returned, where the 'x's are the hexadecimal
     * values of the eight 16-bit pieces of the address, according to rfc5952.
     * In cases where there is more than one field of only zeros, it can be shortened. For example, 2001:0db8:0:0:0:1:0:1
     * will be expressed as 2001:0db8::1:0:1.
     *
     * @param {String} [encoding]
     * @returns {String}
     */
    toString(encoding) {
        if (encoding === "hex") {
            // backward compatibility: behave in the same way as the buffer
            return this.buffer.toString("hex");
        }
        if (this.buffer.length === 4) {
            return this.buffer.join(".");
        }
        let start = -1;
        const longest = { length: 0, start: -1 };
        function checkLongest(i) {
            if (start >= 0) {
                // close the group
                const length = i - start;
                if (length > longest.length) {
                    longest.length = length;
                    longest.start = start;
                    start = -1;
                }
            }
        }
        // get the longest 16-bit group of zeros
        for (let i = 0; i < this.buffer.length; i = i + 2) {
            if (this.buffer[i] === 0 && this.buffer[i + 1] === 0) {
                // its a group of zeros
                if (start < 0) {
                    start = i;
                }

                // at the end of the buffer, make a final call to checkLongest.
                if (i === this.buffer.length - 2) {
                    checkLongest(i + 2);
                }
                continue;
            }
            // its a group of non-zeros
            checkLongest(i);
        }

        let address = "";
        for (let h = 0; h < this.buffer.length; h = h + 2) {
            if (h === longest.start) {
                address += ":";
                continue;
            }
            if (h < longest.start + longest.length && h > longest.start) {
                // its a group of zeros
                continue;
            }
            if (address.length > 0) {
                address += ":";
            }
            address += ((this.buffer[h] << 8) | this.buffer[h + 1]).toString(
                16,
            );
        }
        if (address.charAt(address.length - 1) === ":") {
            address += ":";
        }
        return address;
    }

    /**
     * Returns the string representation.
     * Method used by the native JSON.stringify() to serialize this instance.
     * @returns {String}
     */
    toJSON() {
        return this.toString();
    }

    /**
     * Validates for a IPv4-Mapped IPv6 according to https://tools.ietf.org/html/rfc4291#section-2.5.5
     * @private
     * @param {Buffer} buffer
     */
    static #isValidIPv4Mapped(buffer) {
        // check the form
        // |      80 bits   | 16 |   32 bits
        // +----------------+----+-------------
        // |0000........0000|FFFF| IPv4 address

        for (let i = 0; i < buffer.length - 6; i++) {
            if (buffer[i] !== 0) {
                return false;
            }
        }
        return !(buffer[10] !== 255 || buffer[11] !== 255);
    }
}

module.exports = InetAddress;
