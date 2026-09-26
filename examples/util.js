function getClientArgs() {
    return {
        contactPoints: [process.env.SCYLLA_URI ?? "172.17.0.2:9042"],
        localDataCenter:
            process.env.DATACENTER ??
            (process.env.SCYLLA_URI === undefined ? "datacenter1" : undefined),
    };
}

exports.getClientArgs = getClientArgs;
