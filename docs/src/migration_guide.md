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
