import type { CqlValue } from "../main";
import Encoder = require("./encoder");
import errors = require("./errors");
import type { ColumnInfo } from "./types/cql-utils";

/** Largest value count that the `[short]` count of a frame can hold. */
const MAX_FRAME_VALUES = 0xffff;
const NULL_LENGTH = -1;
const UNSET_LENGTH = -2;
/** The buffer size of a new {@link FrameWriter}. */
const INITIAL_FRAME_SIZE = 4096;
/**
 * A {@link FrameWriter} keeps its buffer between frames up to this size.
 * After a larger frame, it starts again with a small buffer.
 */
const MAX_RETAINED_FRAME_SIZE = 16 * INITIAL_FRAME_SIZE;

/**
 * Encodes values into values frames, in the request frame layout:
 * `[u16 count]`, then for each value `[i32 length][bytes]`.
 * Length -1 is null, and -2 is unset.
 *
 * The writer reuses its buffer between frames.
 * A frame is a view of that buffer, valid until the next frame of the same writer.
 * Thus, pass a frame to Rust immediately.
 * This is safe, because Rust copies the frame before the native call returns.
 *
 * A writer writes one frame at a time.
 * A nested frame on the same writer throws, because it would overwrite the frame in progress.
 */
export class FrameWriter {
    #buffer = Buffer.allocUnsafe(INITIAL_FRAME_SIZE);
    #busy = false;

    /**
     * Encodes all params of a statement into one frame.
     * @param expectedTypes List of expected types.
     * @param params
     * @param encoder
     * @returns The frame, valid until the next frame of this writer.
     * @throws ArgumentError when there are more than 65,535 params
     */
    params(
        expectedTypes: Array<ColumnInfo | null>,
        params: Array<CqlValue>,
        encoder: Encoder,
    ): Buffer {
        return this.#frame(() => {
            const count = params ? params.length : 0;
            let offset = this.#writeRowHeader(count, 0);
            for (let i = 0; i < count; i++) {
                offset = this.#writeEncodedCell(
                    encoder.encode(params[i], expectedTypes[i]),
                    offset,
                );
            }
            return offset;
        });
    }

    /**
     * Writes one frame.
     * @param write Writes the frame from offset 0, and returns the offset after it.
     * @returns A view of the frame.
     * @throws Error when this writer is already writing a frame
     */
    #frame(write: () => number): Buffer {
        if (this.#busy) {
            throw new Error("This FrameWriter is already writing a frame");
        }
        this.#busy = true;
        try {
            // Call write first: it can replace this.#buffer when the frame grows.
            const end = write();
            return this.#buffer.subarray(0, end);
        } finally {
            this.#busy = false;
            // The returned frame keeps a large buffer alive until Rust has copied it.
            if (this.#buffer.length > MAX_RETAINED_FRAME_SIZE) {
                this.#buffer = Buffer.allocUnsafe(INITIAL_FRAME_SIZE);
            }
        }
    }

    /**
     * Makes room for `needed` more bytes after the first `used` bytes.
     * When the buffer grows, it copies only the `used` bytes.
     */
    #ensure(used: number, needed: number): void {
        if (used + needed <= this.#buffer.length) return;
        let size = this.#buffer.length * 2;
        while (size < used + needed) size *= 2;
        const grown = Buffer.allocUnsafe(size);
        this.#buffer.copy(grown, 0, 0, used);
        this.#buffer = grown;
    }

    /**
     * Writes the `[u16 count]` that starts a row of values.
     * @returns The offset after the count.
     * @throws ArgumentError when there are more than 65,535 values
     */
    #writeRowHeader(count: number, offset: number): number {
        if (count > MAX_FRAME_VALUES) {
            throw new errors.ArgumentError(
                `Too many values: ${count}, the maximum is ${MAX_FRAME_VALUES}`,
            );
        }
        this.#ensure(offset, 2);
        this.#buffer.writeUInt16BE(count, offset);
        return offset + 2;
    }

    /**
     * Writes one value that is already encoded, as `[i32 length][bytes]`.
     * `null` is written as length -1, and `undefined` (unset) as length -2.
     * @returns The offset after the value.
     */
    #writeEncodedCell(
        value: Uint8Array | null | undefined,
        offset: number,
    ): number {
        switch (value) {
            case null:
                return this.#writeLength(NULL_LENGTH, offset);
            case undefined:
                return this.#writeLength(UNSET_LENGTH, offset);
            default:
                // Fails to compile if the parameter type gets a member that is not a Uint8Array.
                value satisfies Uint8Array;
                offset = this.#writeLength(value.length, offset, value.length);
                this.#buffer.set(value, offset);
                return offset + value.length;
        }
    }

    /**
     * Writes `[i32 length]` at `offset`, with room for `bytes` more bytes after it.
     * @returns The offset after the length.
     */
    #writeLength(length: number, offset: number, bytes: number = 0): number {
        this.#ensure(offset, 4 + bytes);
        this.#buffer.writeInt32BE(length, offset);
        return offset + 4;
    }
}
