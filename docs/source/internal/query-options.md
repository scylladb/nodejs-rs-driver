# Query options overview

Ordinary `execute()` calls build `ExecutionOptions` and a native
`QueryOptionsWrapper` from the supplied `QueryOptions`. The wrapper receives
its fields as positional arguments. `batch()` uses the same creation path.

## Explicit reuse

`Client.createReusableOptions()` resolves query settings once and returns a
client-owned handle. It copies query values and captures the effective client
defaults and execution profile. Each `execute()` call using the handle gets a
separate `ExecutionOptions` view for request-specific state while sharing the
native wrapper. A handle from another client is rejected.

Input arrays, plain objects, buffers, and `Long` values are copied when the
handle is created. Policy and host instances retain their references so their
behavior remains available. Changes to the source options, defaults, or
profile do not change captured settings; callers create a new handle to use
changed settings.

Plain `QueryOptions` objects do not enter a client cache. `eachRow()` and
`stream()` continue creating their own execution options. The concurrent
executors obtain options at construction and reuse them for that executor.
