function getClientArgs() {
    return {
        contactPoints: [process.env.SCYLLA_URI ?? "172.17.0.2:9042"],
        // At this point the driver does not support localDataCenter client option.
        // Providing this option does not have any effect.
        // localDataCenter: process.env.DATACENTER ?? "datacenter1",
    };
}

exports.getClientArgs = getClientArgs;
