# Migration guide

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
but the meaning of those option remains unchanged:

- `id`: Now accepts both uuid and string types. When uuid is provided, it will be passed to the database in standard string representation.

The following options' default values have changes:

- `encoding.useBigIntAsLong`: New default - `true` (previously - `false`),
- `encoding.useBigIntAsVarint`: New default - `true` (previously - `false`)

With the update of encoding options, we encourage usage of the builtin types.
The ability to use the driver with types is kept as a legacy option, and may be removed in the future.

## Load balancing policies

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

The following policies, that were present in the DataStax driver are not supported:

- `WhiteListPolicy`
- (legacy) `DefaultLoadBalancingPolicy`
- custom load balancing policies

#### WhiteListPolicy

This policy was deprecated in the DataStax driver, and for this reason was removed from this driver.
You can use `AllowListPolicy` instead.

#### legacy DefaultLoadBalancingPolicy

The `DefaultLoadBalancingPolicy` as present in the DataStax driver is no longer supported.
It was replaced with a [new implementation](./load_balancing.md). There are no plans for
re-creating its functionality.

To achieve similar behavior, you can update your code in the following way:

```js
const DefaultLoadBalancingPolicy = require("scylladb-driver-alpha").policies.loadBalancing.DefaultLoadBalancingPolicy;

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
This is a change in behavior. In the DataStax driver, when `localDc` would not be provided,
`localDataCenter` from client options would be used.
