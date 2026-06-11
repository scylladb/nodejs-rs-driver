# Shutdown

It is not possible to explicitly close the connection to the database.
The connection is closed when the `Client` object is garbage collected.
Even though removal of references to the object is explicit,
the actual GC run that frees objects that have no active references to is implicit.

In the Apache `cassandra-driver`, it is possible to explicitly close the connection to the database.
In contrast, the ScyllaDB Rust Driver, which this driver relies upon,
shuts down the connection when the value representing given session is dropped.

## client.shutdown()

To maintain compatibility with the `cassandra-driver` API, it's possible to call `shutdown` on a given client.
This method is marked as deprecated and may be removed in the future. Currently the only functionality
it provides is preventing execution of any new statements with the given client. It does **not**:

- Close the connection to the database.
- Deallocate connection-related structures.
- Stop queries that are currently in flight.
