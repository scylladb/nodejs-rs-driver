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

    /** @param size The size of the first buffer. */
    constructor(size: number) {
        this.buffer = Buffer.allocUnsafe(size);
    }

    /**
     * Makes room for `needed` more bytes after the first `used` bytes.
     * When the buffer grows, it copies only the `used` bytes.
     * `used` can be past the end of the buffer. Then it copies the whole buffer.
     * For example, the Encoder leaves a hole for the length of a cell, and writes the bytes
     * of the cell after it. The hole can end past the buffer. Then the bytes start
     * past the end of the buffer.
     */
    ensure(used: number, needed: number): void {
        if (used + needed <= this.buffer.length) return;
        let size = this.buffer.length * 2;
        while (size < used + needed) size *= 2;
        const grown = Buffer.allocUnsafe(size);
        this.buffer.copy(grown, 0, 0, used);
        this.buffer = grown;
    }
}
