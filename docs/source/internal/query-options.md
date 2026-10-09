# Query options overview

When a user provides options for a query, the driver creates or reuses an
`ExecutionOptions` object. Before using these options in Rust, the driver
converts them to `QueryOptionsWrapper`.

Because creation of those options requires a number of native calls,
the process of converting execution options from Node to Rust part is time-consuming.

## Query options reuse

`Client.createOptions()` caches execution options and the native wrapper per
client. `execute()`, `batch()`, and the concurrent executors use this path.
Calls using the same plain `QueryOptions` object reuse them while the top-level
option values, client defaults, selected profile, and request timeout stay the
same.
Plain objects with equivalent scalar values can also share them, even when
they are different objects. The equivalent-object cache holds at most 64
entries per client. It stores a frozen snapshot, so
`ExecutionOptions.getRawQueryOptions()` can return that snapshot instead of
the caller's object. Nonscalar query values stay on the per-object path.
Proxies, accessors, inherited values, and symbol keys bypass caching. Caching
also requires plain data properties in client defaults and the selected
profile. Calls without a query-options object create new options.

`eachRow()` and `stream()` create options for each call rather than using this
client cache.

`ArrayBasedExecutor` and `StreamBasedExecutor` obtain options at construction
and reuse them for every query in that executor. Equivalent scalar options can
also be retained in the client cache and reused by a later executor.
