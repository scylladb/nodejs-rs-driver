# Shutdown

It is not possible to explicitly close connection to the database.
A connection is closed when the client variable associated with this connection is collected by the garbage collector.  
Even though removal of references to the object is explicit,
the actual GC run that frees objects that have no active references to is implicit.

In the DataStax NodeJS driver, it is possible to explicitly close the connection to the database.
In contrast, the ScyllaDB Rust driver, which this driver relies upon,
shuts down the connection when the value representing given session is dropped.

## client.shutdown()

To maintain compatibility with the DataStax driver API, it's possible to call ``shutdown`` on a given client.
This endpoint is marked as deprecated and may be removed in the future. Currently the only functionality
it provides is preventing execution of any new queries with the given client. It does **not** close connection
to the database nor deallocate any structures related to that connection nor stop any queries being currently executed.
