# Compression

The driver can compress the frames exchanged with the nodes. Compression reduces network traffic
at the cost of some CPU time, and is most useful for large results or large writes over a slow link.

Enable it with the `protocolOptions.compression` option. Supported values are `"lz4"` and `"snappy"`.
When the option is not set, no compression is used.

```javascript
const { Client } = require("@scylladb/driver");

(async () => {
    const client = new Client({
        contactPoints: ["127.0.0.1"],
        localDataCenter: "datacenter1",
        protocolOptions: {
            compression: "lz4",
        },
    });

    await client.connect();
    // ...
    await client.shutdown();
})();
```

Any other value is rejected with a `TypeError` when the `Client` is created.

> **Note:** If a node does not support the selected algorithm, the driver logs a warning and
> falls back to no compression for connections to that node.
