/**
 * The size of the first buffer of a FrameWriter.
 * It must not be 0, because {@link GrowableBuffer.ensure} doubles the size.
 * @internal
 * @ignore
 */
export const INITIAL_FRAME_SIZE = 4096;

/**
 * The default of {@link GrowableBuffer.maxRetainedSize}.
 * @internal
 * @ignore
 */
export const DEFAULT_MAX_RETAINED_FRAME_SIZE = 64 * 1024;

/**
 * A buffer that grows when a write needs more room.
 *
 * Writers call {@link ensure} before each write, and then write into {@link buffer}.
 * Thus, read {@link buffer} again after each call to {@link ensure}:
 * the call can replace it with a larger buffer.
 * @internal
 * @ignore
 */
export class GrowableBuffer {
    buffer: Buffer;
    /**
     * The owner of this buffer keeps it between uses up to this size.
     * After a use that grows it past this size, the owner starts again with a small buffer.
     * Thus, a writer should avoid making the buffer grow past this size for bytes that it does not write.
     *
     * {@link ensure} grows the buffer to at most this size when the bytes fit in it.
     * So writes that end at most at this size never make the buffer grow past it.
     * This is true for any size, not only for the first size times a power of 2.
     */
    readonly maxRetainedSize: number;

    /**
     * @param size The size of the first buffer.
     * @param maxRetainedSize See {@link maxRetainedSize}.
     */
    constructor(
        size: number,
        maxRetainedSize: number = DEFAULT_MAX_RETAINED_FRAME_SIZE,
    ) {
        this.buffer = Buffer.allocUnsafe(size);
        this.maxRetainedSize = maxRetainedSize;
    }

    /**
     * Makes room for `needed` more bytes after the first `used` bytes.
     * When the buffer grows, it copies only the `used` bytes.
     * `used` can be past the end of the buffer. Then it copies the whole buffer.
     * For example, the Encoder leaves a hole for the length of a cell, and writes the bytes
     * of the cell after it. The hole can end past the buffer. Then the bytes start
     * past the end of the buffer.
     *
     * The buffer doubles until it has room. But when the bytes fit in {@link maxRetainedSize},
     * it grows to at most that size.
     */
    ensure(used: number, needed: number): void {
        const end = used + needed;
        if (end <= this.buffer.length) return;
        let size = this.buffer.length * 2;
        while (size < end) size *= 2;
        if (size > this.maxRetainedSize && end <= this.maxRetainedSize) {
            size = this.maxRetainedSize;
        }
        const grown = Buffer.allocUnsafe(size);
        this.buffer.copy(grown, 0, 0, used);
        this.buffer = grown;
    }
}
