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

The following option implementation has changed significantly,
but the meaning of the option remains unchanged:

- `id`: Now accepts both `Uuid` and string types. When a `Uuid` is provided, it will be passed to the database in its standard string representation.

The following options' default values have changed:

- `encoding.useBigIntAsLong`: New default - `true` (previously - `false`),
- `encoding.useBigIntAsVarint`: New default - `true` (previously - `false`)

With the update of encoding options, we encourage usage of the builtin types.
The ability to use the driver with types is kept as a legacy option, and may be removed in the future.

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
