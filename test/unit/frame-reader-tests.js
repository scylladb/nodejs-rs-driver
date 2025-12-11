"use strict";
const assert = require("assert");
const { FrameReader } = require("../../lib/reader");

describe("FrameReader", function () {
    describe("#constructor()", function () {
        it("should create a reader with offset 0", function () {
            const buffer = Buffer.from([1, 2, 3, 4]);
            const reader = new FrameReader(buffer);
            assert.strictEqual(reader.offset, 0);
            assert.strictEqual(reader.buf, buffer);
        });

        it("should handle empty buffers", function () {
            const buffer = Buffer.alloc(0);
            const reader = new FrameReader(buffer);
            assert.strictEqual(reader.offset, 0);
            assert.strictEqual(reader.buf.length, 0);
        });
    });

    describe("#slice()", function () {
        it("should slice the buffer from begin to end", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            const sliced = reader.slice(1, 3);
            assert.deepStrictEqual(sliced, Buffer.from([2, 3]));
        });

        it("should slice to the end when end is not provided", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            const sliced = reader.slice(2);
            assert.deepStrictEqual(sliced, Buffer.from([3, 4, 5]));
        });

        it("should not modify the offset", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            reader.slice(1, 3);
            assert.strictEqual(reader.offset, 0);
        });
    });

    describe("#read()", function () {
        it("should read specified number of bytes and update offset", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            const result = reader.read(3);
            assert.deepStrictEqual(result, Buffer.from([1, 2, 3]));
            assert.strictEqual(reader.offset, 3);
        });

        it("should read to the end when length is not provided", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            const result = reader.read();
            assert.deepStrictEqual(result, Buffer.from([1, 2, 3, 4, 5]));
            assert.strictEqual(reader.offset, 5);
        });

        it("should read to the end when length is larger than remaining bytes", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            const result = reader.read(10);
            assert.deepStrictEqual(result, Buffer.from([1, 2, 3, 4, 5]));
            assert.strictEqual(reader.offset, 5);
        });

        it("should read from current offset", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            reader.offset = 2;
            const result = reader.read(2);
            assert.deepStrictEqual(result, Buffer.from([3, 4]));
            assert.strictEqual(reader.offset, 4);
        });

        it("should handle reading from empty buffer", function () {
            const buffer = Buffer.alloc(0);
            const reader = new FrameReader(buffer);
            const result = reader.read(5);
            assert.deepStrictEqual(result, Buffer.alloc(0));
            assert.strictEqual(reader.offset, 0);
        });

        it("should handle reading when offset is at the end", function () {
            const buffer = Buffer.from([1, 2, 3]);
            const reader = new FrameReader(buffer);
            reader.offset = 3;
            const result = reader.read(5);
            assert.deepStrictEqual(result, Buffer.alloc(0));
            assert.strictEqual(reader.offset, 3);
        });
    });

    describe("#readInt()", function () {
        it("should read a BE 32-bit integer and update offset", function () {
            const buffer = Buffer.alloc(4);
            buffer.writeInt32BE(12345, 0);
            const reader = new FrameReader(buffer);
            const result = reader.readInt();
            assert.strictEqual(result, 12345);
            assert.strictEqual(reader.offset, 4);
        });

        it("should read negative integers correctly", function () {
            const buffer = Buffer.alloc(4);
            buffer.writeInt32BE(-1, 0);
            const reader = new FrameReader(buffer);
            const result = reader.readInt();
            assert.strictEqual(result, -1);
            assert.strictEqual(reader.offset, 4);
        });

        it("should read from current offset", function () {
            const buffer = Buffer.alloc(8);
            buffer.writeInt32BE(100, 0);
            buffer.writeInt32BE(200, 4);
            const reader = new FrameReader(buffer);
            reader.offset = 4;
            const result = reader.readInt();
            assert.strictEqual(result, 200);
            assert.strictEqual(reader.offset, 8);
        });

        it("should read multiple integers sequentially", function () {
            const buffer = Buffer.alloc(12);
            buffer.writeInt32BE(1, 0);
            buffer.writeInt32BE(2, 4);
            buffer.writeInt32BE(3, 8);
            const reader = new FrameReader(buffer);
            assert.strictEqual(reader.readInt(), 1);
            assert.strictEqual(reader.readInt(), 2);
            assert.strictEqual(reader.readInt(), 3);
            assert.strictEqual(reader.offset, 12);
        });
    });

    describe("#checkOffset()", function () {
        it("should not throw when reading within buffer bounds", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            assert.doesNotThrow(() => reader.checkOffset(5));
        });

        it("should not throw when reading exactly to buffer end", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            reader.offset = 3;
            assert.doesNotThrow(() => reader.checkOffset(2));
        });

        it("should throw RangeError when reading beyond buffer bounds", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            assert.throws(() => reader.checkOffset(6), RangeError);
        });

        it("should throw RangeError with expectedLength property", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            try {
                reader.checkOffset(10);
                assert.fail("Should have thrown RangeError");
            } catch (err) {
                assert.strictEqual(err instanceof RangeError, true);
                assert.strictEqual(err.expectedLength, 10);
                assert.strictEqual(
                    err.message,
                    "Trying to access beyond buffer length",
                );
            }
        });

        it("should consider current offset when checking bounds", function () {
            const buffer = Buffer.from([1, 2, 3, 4, 5]);
            const reader = new FrameReader(buffer);
            reader.offset = 3;
            assert.throws(() => reader.checkOffset(3), RangeError);
        });
    });

    describe("#readBytes()", function () {
        it("should read bytes with length prefix", function () {
            const buffer = Buffer.alloc(8);
            buffer.writeInt32BE(4, 0); // length
            buffer.writeUInt8(10, 4);
            buffer.writeUInt8(20, 5);
            buffer.writeUInt8(30, 6);
            buffer.writeUInt8(40, 7);
            const reader = new FrameReader(buffer);
            const result = reader.readBytes();
            assert.deepStrictEqual(result, Buffer.from([10, 20, 30, 40]));
            assert.strictEqual(reader.offset, 8);
        });

        it("should return null when length is negative", function () {
            const buffer = Buffer.alloc(4);
            buffer.writeInt32BE(-1, 0);
            const reader = new FrameReader(buffer);
            const result = reader.readBytes();
            assert.strictEqual(result, null);
            assert.strictEqual(reader.offset, 4);
        });

        it("should return empty buffer when length is 0", function () {
            const buffer = Buffer.alloc(4);
            buffer.writeInt32BE(0, 0);
            const reader = new FrameReader(buffer);
            const result = reader.readBytes();
            assert.deepStrictEqual(result, Buffer.alloc(0));
            assert.strictEqual(reader.offset, 4);
        });

        it("should throw RangeError when trying to read beyond buffer", function () {
            const buffer = Buffer.alloc(8);
            buffer.writeInt32BE(10, 0); // length is 10 but only 4 bytes remain
            const reader = new FrameReader(buffer);
            assert.throws(() => reader.readBytes(), RangeError);
        });

        it("should handle reading multiple byte fields", function () {
            const buffer = Buffer.alloc(14);
            // First field: length 2
            buffer.writeInt32BE(2, 0);
            buffer.writeUInt8(1, 4);
            buffer.writeUInt8(2, 5);
            // Second field: length 3
            buffer.writeInt32BE(3, 6);
            buffer.writeUInt8(3, 10);
            buffer.writeUInt8(4, 11);
            buffer.writeUInt8(5, 12);

            const reader = new FrameReader(buffer);
            const first = reader.readBytes();
            const second = reader.readBytes();

            assert.deepStrictEqual(first, Buffer.from([1, 2]));
            assert.deepStrictEqual(second, Buffer.from([3, 4, 5]));
            assert.strictEqual(reader.offset, 13);
        });

        it("should handle null values between valid byte fields", function () {
            const buffer = Buffer.alloc(16);
            // First field: length 2
            buffer.writeInt32BE(2, 0);
            buffer.writeUInt8(1, 4);
            buffer.writeUInt8(2, 5);
            // Second field: null (-1)
            buffer.writeInt32BE(-1, 6);
            // Third field: length 2
            buffer.writeInt32BE(2, 10);
            buffer.writeUInt8(3, 14);
            buffer.writeUInt8(4, 15);

            const reader = new FrameReader(buffer);
            const first = reader.readBytes();
            const second = reader.readBytes();
            const third = reader.readBytes();

            assert.deepStrictEqual(first, Buffer.from([1, 2]));
            assert.strictEqual(second, null);
            assert.deepStrictEqual(third, Buffer.from([3, 4]));
        });
    });
});
