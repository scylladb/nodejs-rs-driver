"use strict";

/**
 * Buffer forward reader of CQL binary frames
 */
class FrameReader {
    offset: number;
    buf: Buffer;

    /**
     * Creates a new instance of the reader
     */
    constructor(body: Buffer) {
        this.offset = 0;
        this.buf = body;
    }

    /**
     * Slices the underlying buffer
     */
    slice(begin: number, end?: number): Buffer {
        if (typeof end === "undefined") {
            end = this.buf.length;
        }
        return this.buf.slice(begin, end);
    }

    /**
     * Reads any number of bytes and moves the offset.
     * if length not provided or it's larger than the remaining bytes, reads to end.
     * @param length
     */
    read(length?: number): Buffer {
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
     */
    readInt(): number {
        this.checkOffset(4);
        const result = this.buf.readInt32BE(this.offset);
        this.offset += 4;
        return result;
    }

    /**
     * Checks that the new length to read is within the range of the buffer length. Throws a RangeError if not.
     */
    checkOffset(newLength: number): void {
        if (this.offset + newLength > this.buf.length) {
            const err = new RangeError("Trying to access beyond buffer length");
            // The reader tags the error with how much it wanted to read, which
            // `lib/encoder.js` reads back when it catches a short frame.
            (err as any).expectedLength = newLength;
            throw err;
        }
    }

    /**
     * Reads the amount of bytes that the field has and returns them (slicing them).
     */
    readBytes(): Buffer | null {
        const length = this.readInt();
        if (length < 0) {
            return null;
        }
        this.checkOffset(length);
        return this.read(length);
    }
}

export { FrameReader };
