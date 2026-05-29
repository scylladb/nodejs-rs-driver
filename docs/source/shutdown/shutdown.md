# Shutdown

It is not possible to explicitly close a connection to the database.
A connection is closed when the `Client` instance is collected by the garbage collector.
Although removal of references to the object is explicit, the actual GC run that frees
unreferenced objects is implicit.

This is in contrast to the DataStax Node.js driver, which supports explicit connection closing.
The ScyllaDB Rust driver — which this driver is built on — shuts down the connection when
the session value is dropped.

## client.shutdown()

To maintain API compatibility with the DataStax driver, calling `shutdown()` on a client
is supported. This method is **deprecated** and may be removed in a future release.

Its only effect is to prevent new queries from being submitted on that client instance.
It does **not**:

- Close the underlying connection to the database.
- Deallocate any connection-related structures.
- Stop queries that are currently in flight.
