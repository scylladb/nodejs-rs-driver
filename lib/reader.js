"use strict";

/**
 * Buffer forward reader of CQL binary frames
 */
class FrameReader {
    /**
     * Creates a new instance of the reader
     * @param {Buffer} body
     */
    constructor(body) {
        this.offset = 0;
        this.buf = body;
    }

    /**
     * Slices the underlying buffer
     * @param {Number} begin
     * @param {Number} [end]
     * @returns {Buffer}
     */
    slice(begin, end) {
        if (typeof end === "undefined") {
            end = this.buf.length;
        }
        return this.buf.slice(begin, end);
    }

    /**
     * Reads any number of bytes and moves the offset.
     * if length not provided or it's larger than the remaining bytes, reads to end.
     * @param length
     * @returns {Buffer}
     */
    read(length) {
        let end = this.buf.length;
        if (
            typeof length !== "undefined" &&
            this.offset + length < this.buf.length
        ) {
            end = this.offset + length;
        }
        const bytes = this.slice(this.offset, end);
        this.offset = end;
        return bytes;
    }

    /**
     * Reads a BE Int and moves the offset
     * @returns {Number}
     */
    readInt() {
        this.checkOffset(4);
        const result = this.buf.readInt32BE(this.offset);
        this.offset += 4;
        return result;
    }

    /**
     * Checks that the new length to read is within the range of the buffer length. Throws a RangeError if not.
     * @param {Number} newLength
     */
    checkOffset(newLength) {
        if (this.offset + newLength > this.buf.length) {
            const err = new RangeError("Trying to access beyond buffer length");
            err.expectedLength = newLength;
            throw err;
        }
    }

    /**
     * Reads the amount of bytes that the field has and returns them (slicing them).
     * @returns {Buffer}
     */
    readBytes() {
        const length = this.readInt();
        if (length < 0) {
            return null;
        }
        this.checkOffset(length);
        return this.read(length);
    }
}

module.exports = { FrameReader };
