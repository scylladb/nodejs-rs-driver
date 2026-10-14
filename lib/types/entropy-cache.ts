import crypto = require("crypto");
import { registerEntropyCacheSnapshotReset } from "./entropy-cache-snapshot";

// Keep the previous combined capacity: 128 UUID v4 values plus 128 full
// TimeUUID IDs. Both types consume fresh bytes from this one cache.
const entropyCache = Buffer.alloc(128 * (16 + 8));
let entropyOffset = entropyCache.length;

registerEntropyCacheSnapshotReset(entropyCache, () => {
    entropyOffset = entropyCache.length;
});

/** Copies fresh cached entropy into an independent result buffer.
 * @private
 */
export function fillRandomBytes(
    buffer: Buffer,
    offset: number,
    length: number,
): void {
    if (entropyOffset + length > entropyCache.length) {
        // Discard the remainder even if a refill fails after writing some bytes.
        entropyOffset = entropyCache.length;
        crypto.randomFillSync(entropyCache);
        entropyOffset = 0;
    }
    entropyCache.copy(buffer, offset, entropyOffset, entropyOffset + length);
    entropyOffset += length;
}
