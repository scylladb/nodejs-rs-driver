# Migration Guide

This guide describes the differences between the ScyllaDB Node.js RS Driver
and the Apache `cassandra-driver` (formerly the DataStax `cassandra-driver`, which was transferred to Apache),
to help you migrate existing applications.

## Shutdown behavior

In the Apache `cassandra-driver`, you can explicitly close the connection to the database using `client.shutdown()`.
The ScyllaDB Node.js RS Driver behaves differently: it is not possible to explicitly close the connection.
The connection is closed when the `Client` object is garbage collected.

When `client.shutdown()` is called in the Node.js RS Driver:
- It prevents execution of any new statements with the given client.
- It does **not** close the connection to the database.
- It does **not** deallocate connection-related structures.
- It does **not** stop queries that are currently in flight.

See [Shutdown](../shutdown/shutdown.md) for more details.

## Query options

The following options' remain unchanged:

- `autoPage`
- `consistency`
- `fetchSize`
- `hints`
- `prepare`
- `serialConsistency`
- `timestamp`

The following option is no longer supported:

- `graphOptions`: those options configure DSx specific features, that are not supported in this driver

## Client options

The following options remain unchanged:

- `contactPoints`
- `keyspace`
- `credentials`
- `credentials.username`
- `credentials.password`
- `applicationName`
- `applicationVersion`
- `encoding.map`
- `encoding.set`
- `encoding.copyBuffer`
- `encoding.useUndefinedAsUnset`
- `maxPrepared`
- `protocolOptions.port`: applied to every contact point that does not carry its own
  `ipAddress:port` suffix, and defaulting to 9042

The following option implementation has changed significantly,
but the meaning of the option remains unchanged:

- `id`: Now accepts both `Uuid` and string types. When a `Uuid` is provided, it will be passed to the database in its standard string representation.

The following options' default values have changed:

- `encoding.useBigIntAsLong`: New default - `true` (previously - `false`),
- `encoding.useBigIntAsVarint`: New default - `true` (previously - `false`)

With the update of encoding options, we encourage usage of the builtin types.
The ability to use the driver with types is kept as a legacy option, and may be removed in the future.

The following option is new, with no `cassandra-driver` equivalent:

- `protocolOptions.autoAwaitSchemaAgreement`: determines whether the driver automatically waits
  for schema agreement after a DDL statement before resolving the query, retrying for up to
  `protocolOptions.maxSchemaAgreementWaitSeconds`. See the [Schema Agreement](#schema-agreement)
  section for more information. Defaults to `true`.

## Client internal members

In the `cassandra-driver`, several `Client` members were accessible at runtime
from JavaScript even though they were marked as private (internal) in the
driver's TypeScript type definitions. Because the two APIs disagreed, any change
would break at least one of them at any given moment.

The ScyllaDB Node.js RS Driver unifies both APIs by treating these members as
internal. They are no longer part of the public API and may change or be removed
without notice. The following `Client` members are now internal:

- `options`
- `connected`
- `connecting`
- `isShuttingDown`

If your application read any of these members, you should stop relying on them.

## Unprepared statements with bind markers

When an unprepared statement contains bind markers (`?`), the driver silently
prepares the statement before execution. This is especially important in batches: for each
statement with a non-empty list of values, the driver sends a prepare request **sequentially**,
and results are **not cached** between `client.batch()` calls.

Avoid using unprepared batches unless all statements take no bind markers.

## Load balancing policies

Unless you have specific requirements about load balancing policies, we recommend using the default
load balancing policy. Below you can find a detailed list of changes made to the load balancing
policies compared to the `cassandra-driver`.

### Supported load balancing policies

The following policies are still supported by the driver:

- `AllowListPolicy`
- `DCAwareRoundRobinPolicy`
- `RoundRobinPolicy`
- `TokenAwarePolicy`

For the `DCAwareRoundRobinPolicy` and `RoundRobinPolicy` the following change was made to their behavior:
Instead of trying hosts in a fixed order, the next host is chosen at random. This is done to avoid situations,
where a traffic from a closed node is redirected to a single next node, potentially overloading it.

If for some reason you rely on this specific order of queueing hosts, you may still replicate old
behavior of those policies through proper configuration of (new) `DefaultLoadBalancingPolicy`.
The (new) `DefaultLoadBalancingPolicy` can be used as a child policy to `TokenAwarePolicy` and `AllowListPolicy` policies.

### Not supported load balancing policies

The following policies that were present in the `cassandra-driver` are not supported:

- `WhiteListPolicy`
- (legacy) `DefaultLoadBalancingPolicy`
- custom load balancing policies

#### WhiteListPolicy

This policy was deprecated in the `cassandra-driver`, and for this reason was removed from this driver.
You can use `AllowListPolicy` instead.

#### legacy DefaultLoadBalancingPolicy

The `DefaultLoadBalancingPolicy` as present in the `cassandra-driver` is no longer supported.
It was replaced with a [new implementation](../policies/load-balancing.md). There are no plans for
re-creating its functionality.

To achieve similar behavior, you can update your code in the following way:

```js
const DefaultLoadBalancingPolicy = require("@scylladb/driver").policies.loadBalancing.DefaultLoadBalancingPolicy;

// Old version
let policy = new DefaultLoadBalancingPolicy({
    localDc: "my_dc",
    filter: filterAsFunction
});

// New version
let policy = new DefaultLoadBalancingPolicy({
    preferDatacenter: "my_dc",
    // The new policy no longer accepts the filter as a function
    // You must convert it to a list of hosts that are accepted (in the `ip:port` format)
    allowList: filterAsListOfAcceptedHosts
});
```

## defaultLoadBalancingPolicy()

The policy returned from `defaultLoadBalancingPolicy()` is changed from
legacy to new `DefaultLoadBalancingPolicy`. When `localDc` option is provided,
the load balancing will be set to allow connection to the provided datacenter.
When `localDc` is not provided connections to all nodes will be allowed.

**WARNING**:
This is a change in behavior. In the `cassandra-driver`, when `localDc` would not be provided,
`localDataCenter` from client options would be used.

## Retry policies

A new version of the default retry policy was introduced. We recommend using it as a replacement
for the legacy default policy.

### Supported retry policies

- `FallthroughRetryPolicy`

### Not supported retry policy

- (legacy) `RetryPolicy`
- `IdempotenceAwareRetryPolicy`
- custom retry policies

#### legacy RetryPolicy

The `RetryPolicy` as present in the `cassandra-driver` is no longer supported.
It was replaced with a [new implementation](../policies/retry-policy.md). There are no plans for
re-implementing its functionality. You do not have to update your code to migrate to the new policy.

#### IdempotenceAwareRetryPolicy

This policy was deprecated in the `cassandra-driver`, and for this reason was removed from this driver.

## Metadata

### Hosts

#### Hosts order

The `cassandra-driver` driver had some undocumented assumptions about the order of hosts,
when using `client.hosts.keys()` - see issue [#282](https://github.com/scylladb/nodejs-rs-driver/issues/282)
(they were checked in the driver tests). Those assumptions no longer hold true,
the hosts returned from `client.hosts.keys()` may be in a random order, that may vary from run to run.

### UP/DOWN distinction

Previously, the Host was set as UP or DOWN as a result of received events. Now, whether a Host is considered
as UP depends on whether it has an established open connection with the driver.

#### `Host.address` is now a `net.SocketAddress`

In the `cassandra-driver`, `host.address` was a plain string in the `ip:port` format.
In the ScyllaDB Node.js RS Driver, it is a real
[`net.SocketAddress`](https://nodejs.org/api/net.html#class-netsocketaddress) object.

#### `HostMap` is now keyed by host id, not address

In the `cassandra-driver`, `HostMap` was keyed by a host's address. In the ScyllaDB Node.js RS
Driver, it is keyed by the host's `Uuid` instead, since a host's id never changes, while its
address can (a node can be assigned a new address, or a given address can later be reused by a
different node).

This affects:

- `client.hosts.keys()`: now returns an array of `Uuid`, not addresses.
- `client.hosts.forEach((host, key) => ...)`: `key` is now a `Uuid`, not an address.

`client.hosts.get(key)` is unaffected for existing callers: it still accepts an address
(`net.SocketAddress` or the `ip:port` string), and now also accepts a `Uuid` or the host id as a
raw `Buffer`.

#### Removed `Host`/`HostMap` members

`Host`:

- `dseVersion` (getter/setter) and `getDseVersion()`: specific to DataStax Enterprise (DSE). This driver targets
  open-source Cassandra and ScyllaDB clusters, which have no DSE version to report.
- `workloads` (getter/setter): also DSE-specific (e.g. the Search/Analytics/Graph workloads DSE
  assigns to nodes); not applicable outside DSE.
- `canBeConsideredAsUp()`: determines if the host can be considered as UP – use `Host.isUp()` instead.

`HostMap`:

- `remove()` / `removeMultiple()` / `set()` / `clear()`: `HostMap` is a read-only snapshot of the cluster's current
  topology, built and owned by the driver - hosts cannot be removed or added to it directly and it cannot be cleared.

If your code called any of these, remove the call, as there is no plan to support them in the future.

### Schema

The schema metadata API was rewritten from scratch, and almost nothing carries over unchanged.
See the [Schema Metadata](../metadata/metadata.md) page for the full description of the new API;
this section lists what changes for you as a caller.

#### Everything is synchronous now

In the `cassandra-driver`, schema lookups queried the `system_schema` tables on demand, so they
were asynchronous and took a callback or returned a promise. This driver keeps a schema snapshot
in memory, refreshed in the background, so every lookup returns the value directly:

```javascript
// cassandra-driver
const table = await client.metadata.getTable("ks", "tbl");
client.metadata.getTable("ks", "tbl", (err, table) => { /* ... */ });

// ScyllaDB Node.js RS Driver
const table = client.metadata.getTable("ks", "tbl");
```

#### `metadata.keyspaces` is replaced by `getKeyspace()` / `getKeyspaces()`

The `keyspaces` property, a plain object keyed by keyspace name, no longer exists:

```javascript
// cassandra-driver
const ks = client.metadata.keyspaces["ks"];
const all = Object.values(client.metadata.keyspaces);

// ScyllaDB Node.js RS Driver
const ks = client.metadata.getKeyspace("ks"); // null if absent
const all = client.metadata.getKeyspaces(); // Readonly<Record<string, KeyspaceMetadata>>
```

`getKeyspaces()` returns a read-only object keyed by keyspace name, like the old `keyspaces`
property, so `Object.entries()` still iterates it. Unlike the old property it is not refreshed by
hand: within one cluster state the same record is returned on every call, and a schema change
replaces it.

`KeyspaceMetadata` has `strategy`, `durableWrites`, `tables`, `views` and `udts`.

#### Replication strategy is an object, not a class name plus options

The `cassandra-driver` reported the strategy as the server's Java class name and a bag of options
whose values were strings. It is now a discriminated union, with the replication factors as
numbers:

```javascript
// cassandra-driver
ks.strategy; // "org.apache.cassandra.locator.NetworkTopologyStrategy"
ks.strategyOptions; // { dc1: "3" }

// ScyllaDB Node.js RS Driver
ks.strategy.kind; // StrategyKind.NetworkTopologyStrategy
ks.strategy.datacenterRepfactors; // { dc1: 3 }
```

`strategyOptions` is gone; each variant carries its own fields – `replicationFactor` for
`SimpleStrategy`, `datacenterRepfactors` for `NetworkTopologyStrategy`, nothing for
`LocalStrategy`, and `name`/`data` for a strategy the driver does not recognise. Switch on
`kind` (a `StrategyKind` value) to pick the variant.

#### Iterating columns changes shape

```javascript
// cassandra-driver
table.columns.forEach((column) => console.log(column.name, column.type.code));

// ScyllaDB Node.js RS Driver
for (const [name, column] of Object.entries(table.columns)) {
  console.log(name, column.type.code, column.kind);
}
```

Looking up the partition key columns changes too, since the keys are now names:

```javascript
// cassandra-driver
const pkTypes = table.partitionKeys.map((column) => column.type);

// ScyllaDB Node.js RS Driver
const pkTypes = table.partitionKey.map((name) => table.columns[name].type);
```

Table storage options – `caching`, `comment`, `compactionClass`, `compactionOptions`,
`compression`, `defaultTtl`, `gcGraceSeconds`, `id`, `bloomFilterFalsePositive`,
`speculativeRetry`, `extensions`, `indexes` and the rest – are not exposed. Query
`system_schema` directly if you need any of them.

#### Materialized views and user-defined types

`MaterializedView` still extends the table metadata and still has `tableName`, but
`whereClause` and `includeAllColumns` are not exposed.

`Udt` keeps `name` and `fields` (an array of `{ name, type }`) and gains `keyspace`.

#### Metadata objects are cached, shared and read-only

`client.metadata` is a live view of the state of the cluster, and everything it returns
is a snapshot of it: within one snapshot the same object comes back every time, both
for the schema objects and for the records holding them.

```javascript
const keyspace = client.metadata.getKeyspace("ks");

keyspace.getTable("tbl") === keyspace.tables["tbl"]; // true
keyspace.tables === keyspace.tables; // true
```

:::{caution}
`client.metadata` being live means two calls on it may not see the same cluster state, since a
background refresh can land between them. Objects reached through one `KeyspaceMetadata` are
always mutually consistent; separate `client.metadata` calls are not guaranteed to be. If you need
a consistent view, take the keyspace once and work from it.
:::

Because those instances are shared, they are read-only to full depth: fields cannot be reassigned,
records cannot gain entries, and `partitionKey`, `clusteringKey` and `fields` are readonly arrays.
In TypeScript this is enforced at compile time.

### Query tracing

See the [Query Tracing](../tracing/tracing.md) page for the full description of the tracing API.
Below are the key differences from the `cassandra-driver`.

The returned `QueryTrace` keeps the shape it had in the `cassandra-driver` – `requestType`,
`coordinator`, `parameters`, `startedAt`, `duration`, `clientAddress` and `events`, with each event
carrying `id`, `activity`, `source`, `elapsed` and `thread`. A trace that cannot be read still
reports an error rather than resolving to `null`.

#### Type changes

`startedAt` is a `Date` (instead of the previous `number`), both `coordinator` and `clientAddress` are
`InetAddress` instances, and each event's `id` is a `TimeUuid` (previously `Uuid`).

#### Trace objects are read-only

Unlike the plain objects the `cassandra-driver` returned, every field of `QueryTrace` and
`TracingEvent` is `readonly`, and `events` is a readonly array. Nothing about a trace is meant to be
edited after it is read; in TypeScript this is enforced at compile time.

#### The `consistency` argument has no effect

`getTrace()` still accepts an optional consistency level between the trace id and the callback, so
existing call sites keep compiling and running:

```javascript
const trace = await client.metadata.getTrace(traceId, types.consistencies.all);
```

It is accepted for compatibility only and is not plumbed through to the request, so the trace is
read at the driver's own consistency level regardless of what you pass.

### Schema agreement

#### `checkSchemaAgreement()` computes a different answer

With one node stopped, right after a schema change, the `cassandra-driver` reported `false`
(the stopped node's stale row disagrees). Now the driver reports `true` (the stopped node is
simply not asked, and the reachable nodes agree).

#### `waitForSchemaAgreement()` is new

`client.metadata.waitForSchemaAgreement()`, unlike `checkSchemaAgreement()`, actively retries and
rejects, rather than resolving `false`, when agreement is not reached.

#### `ResultSet.info.isSchemaInAgreement` is removed

The `cassandra-driver` reports whether the automatic wait after a DDL statement converged, as
`isSchemaInAgreement` on `result.info`. This driver has no equivalent field: when
`protocolOptions.autoAwaitSchemaAgreement` (described in [client options](#client-options)) is enabled, the driver
rejects the query outright if agreement is not reached in time, so a successful `ResultSet` with
`isSchemaInAgreement: false` can never exist to read; and when it is disabled, nothing in the
result identifies whether the cluster has converged. Use `waitForSchemaAgreement()` after the query instead.

## Logging

See the [Logging](../logging/logging.md) page for the full documentation of the new logging system.
Below are the key differences from the `cassandra-driver`.

ScyllaDB Node.js RS Driver introduces a concept of configurable logging levels.
While logging levels were already present in `cassandra-driver`, you could only filter according to those
levels after receiving the log information. To allow for better performance, ScyllaDB Node.js RS Driver allows you to
configure received log levels before the logs are emitted, at the client settings level.

### Default log level

When no `logLevel` is specified, events at `warning` level and above are captured.
This is different from `cassandra-driver`, where all events were always emitted.
To receive all events (including `trace` and `debug`), set `logLevel` explicitly:

```javascript
const { Client, types } = require('@scylladb/driver');

const client = new Client({
    contactPoints: ['127.0.0.1'],
    logLevel: types.logLevels.trace
});
```

### `verbose` level removed

The old `verbose` level has been **removed** and replaced by two separate
levels — `trace` and `debug` — giving finer control over diagnostic output.

See [Log levels](../logging/logging.md#log-levels) for the full list.

### `target` replaces `className`

The `cassandra-driver` passed a JS class name (e.g. `"Client"`,
`"Connection"`) as the second argument of the `'log'` event. This driver
passes a `target` string instead:

- For Rust driver events it is a Rust module path
  (e.g. `scylla::network::connection`).
- For JS-side events it is `"Client"`.

This change affects the actual value passed as the second argument of the `'log'` event.
While the function signature is unchanged, existing code that filters or routes events based on
the `target` value may need to be updated.
See [Event arguments](../logging/logging.md#event-arguments) for details.

### Event interface preserved

The `'log'` event signature is unchanged:

```js
client.on('log', (level, target, message, furtherInfo) => { ... });
```

### Cross-client event visibility

All clients share the same underlying Rust tracing subscriber. Each client
receives log events from the entire process, including those triggered by
other `Client` instances.
