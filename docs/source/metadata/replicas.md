# Replicas

Replica placement determines which nodes replicate each partition of data in the cluster.
`client.metadata.getReplicas(keyspaceName, tableName, token)` returns the replicas for a given
token (partition key), which is useful for token-aware routing and understanding data distribution.

**Note:** This endpoint behaves incorrectly when passed a keyspace that doesn't exist – it walks the
global ring from token and returns the first node it finds.

## Specifying a partition

The token parameter accepts two forms:

- **Token**: A pre-computed token object, created via `metadata.newToken()`:

  ```javascript
  const token = client.metadata.newToken(
    Buffer.from("user-123", "utf8"),
    "my_keyspace",
    "my_table"
  );
  const replicas = client.metadata.getReplicas("my_keyspace", "my_table", token);
  ```

- **TokenRange**: A range object; any token within the range identifies its replicas:

  ```javascript
  const range = client.metadata.getTokenRanges()[0];
  const replicas = client.metadata.getReplicas("my_keyspace", "my_table", range);
  ```

## Replica object

Each replica is an object with:

```javascript
{
  host: Host,      // The Host object from client.hosts
  shard: number    // The shard number on that host
}
```

The `host` is the exact same `Host` instance that `client.hosts.get()` returns, so you can compare
by identity:

```javascript
const replicas = client.metadata.getReplicas("ks", "tbl", token);
for (const replica of replicas) {
  const knownHost = client.hosts.get(replica.host.hostId);
  if (replica.host === knownHost) {
    console.log(`Partition lives on ${knownHost.address}, shard ${replica.shard}`);
  }
}
```

## Vnode vs. tablet routing

**Vnode-based routing** (traditional): The cluster has one token ring, divided into vnodes (ranges).
All partitions of a table see the same ranges. `getTokenRanges()` returns the vnode boundaries.

**Tablet-based routing** (ScyllaDB only): Each table is independently divided into tablets
(fixed-size ranges). `getReplicas()` respects tablet boundaries and returns replicas as reported
by the server. Tablet placement is learned dynamically as queries are routed.
