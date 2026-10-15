Tests in ``./integration``, ``./other``, ``./unit-broken`` and ``./unit-not-supported`` are taken from repository https://github.com/datastax/nodejs-driver/tree/master

### SELECT without FROM

`integration/supported/select-without-from-tests.js` checks `SELECT 1` and
`SELECT now()` using simple and prepared execution, including column names,
CQL types, and decoded values. The client has no selected keyspace, and the
suite creates no keyspace or table.

The suite probes `SELECT 1` once and skips only when the server returns a
syntax error for that query. The Rust binding currently exposes the error
class and rendered message rather than the native protocol error code, so
the probe matches the Rust driver's database syntax-error discriminator.
Connection, authentication, invalid-query, and decoding errors fail the
suite. After a successful probe, failures of either query or execution path
also fail the suite. Server support is required for these queries; older
ScyllaDB releases and Cassandra versions without this syntax skip the suite.
