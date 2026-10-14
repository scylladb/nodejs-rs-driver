import v8 = require("v8");

/**
 * A startup snapshot cannot contain the native addon, but a bundle may include
 * Uuid or TimeUuid on its own. If UUIDs are generated while building that
 * snapshot, cached random bytes would be copied to every restored process.
 * Clear them on save and restore so each process refills its own cache.
 */
export function registerEntropyCacheSnapshotReset(
    cache: Buffer,
    resetOffset: () => void,
): void {
    if (!v8.startupSnapshot.isBuildingSnapshot()) return;

    const clearEntropy = () => {
        cache.fill(0);
        resetOffset();
    };
    v8.startupSnapshot.addSerializeCallback(clearEntropy);
    v8.startupSnapshot.addDeserializeCallback(clearEntropy);
}
