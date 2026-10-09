import v8 = require("v8");

/** Discard cached entropy when a startup snapshot is saved or restored. */
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
