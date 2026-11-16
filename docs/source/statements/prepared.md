<!-- This document is heavily based on the rust driver documentation:
https://rust-driver.docs.scylladb.com/stable/statements/statements.html 
and DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/coding-rules/index.html -->

# Executing CQL Statements - Best Practices

The Node.js RS Driver supports all kinds of statements supported by ScyllaDB. The following tables aim to bridge between DB concepts and driver's API.
They include recommendations on which API to use in what cases.

## Kinds of CQL statements (from the CQL protocol point of view)

| Kind of CQL statement | Single               | Batch                                |
|-----------------------|----------------------|--------------------------------------|
| prepared              | prepared statement   | batch of prepared statements         |
| unprepared            | unprepared statement | batch of unprepared statements       |

This is **NOT** strictly related to content of the CQL statement string.

> **Note:** Any kind of CQL statement could technically contain any CQL statement string.
> However, not all combinations are valid — some will be rejected by the database.
> For example, SELECT statements are not permitted inside a batch.

### [Unprepared](./unprepared.md) vs Prepared

Each time a statement is executed by sending a statement string to the DB, it needs to be parsed. The driver does not parse CQL, therefore it sees statement strings as opaque.
There is an option to *prepare* a statement, i.e. parse it once by the DB and associate it with an ID. After preparation, it's enough that the driver sends the ID
and the DB already knows what operation to perform — no more expensive parsing necessary. Moreover, upon preparation the driver receives valuable data for load balancing,
enabling advanced load balancing (and better performance) of all further executions of that prepared statement.

**Key takeaway:** always use prepared statements that you are going to execute multiple times.

You can decide whether a given query will be prepared by setting the `QueryOptions.prepare` option. By default, queries are unprepared.
You do not need to manually handle statement preparation. If you enable the `prepare` option, the driver handles the rest: it either uses
its cache of prepared statements if the statement is present, or prepares the query before execution and keeps the prepared statement in its cache from now on.
The driver keeps a cache of the last `ClientOptions.maxPrepared` statements. This cache ensures you can take full advantage of prepared statements.

:::{caution}
The bind types and parameter names of a prepared statement remain fixed for as long as its cached handle is reused, as in the Rust driver. A schema change does not automatically refresh this metadata. If you change a table or user-defined type used by a prepared statement, create a new `Client` before executing that statement with the changed schema.
:::

Result columns behave differently. The driver reuses the column names and types of a prepared statement's results only while the result metadata stays the same. It detects changes with the result metadata ID when ScyllaDB supports it, and with the column metadata in each response otherwise. A schema change, such as `ALTER TABLE ... ADD` with `SELECT *`, is visible in the next result.

### Bind markers and rolling upgrades

Bind anonymous `?` markers with an array, in statement order:

```js
await client.execute(
    "SELECT * FROM events WHERE account = ? AND id IN ?",
    [account, [firstId, secondId]],
    { prepare: true },
);
```

Use object parameters for explicit `:name` markers:

```js
await client.execute(
    "SELECT * FROM events WHERE account = :account AND id IN :ids",
    { ids: [firstId, secondId], account },
    { prepare: true },
);
```

Do not bind anonymous markers by their server-generated names. For example,
the metadata name for `id IN ?` can be `IN(id)` or `in(id)`, and multiple
anonymous markers can share a name. These names are not a stable API and can
change between server versions. Use arrays for anonymous markers throughout a
rolling upgrade, including when the nodes report different spellings.

For object parameters, the driver looks up each marker's name in the cached
prepared metadata. It collects the values in marker order. In the example
above, `:account` comes first in the statement. The driver sends its value first
even though `ids` is the first object property. The coordinator receives
only positional values, without the object keys. Explicit `:name` markers let
the application choose the lookup names instead of relying on names that the
server generates for anonymous markers.

The driver ignores case when it compares object keys with metadata names.
As a result, `IN(id)` and `in(id)` currently resolve to the same object key.
This does not protect against other name changes or duplicate synthesized
names, so arrays remain the recommended binding for anonymous markers.

The following cases assume that marker order and the meaning of the query stay
the same. By-name binding means object parameters; positional binding means an
array.

| Binding | Change | Effect and required action |
|---------|--------|----------------------------|
| Positional | Synthesized name changes, such as `IN(id)` to another server-generated name | Values still bind by position. Both cached handles and fresh preparations work if bind types stay compatible. |
| By name | Synthesized name changes | An existing cached handle keeps its original lookup names. A fresh preparation can require different object keys. The driver normalizes case-only changes. Other name changes can cause a missing-key error. If names collide, these changes can also bind a value to the wrong marker. Use an array instead. |
| Positional | Explicit `:name` changes | Names do not affect array binding. Changing `:old` to `:new` in the CQL text creates a different query. The driver prepares it separately. If a schema column is renamed, first check that the query itself is still valid. |
| By name | Explicit `:name` changes | Update the corresponding object key when changing the marker in the CQL text. The new query has its own prepared metadata. If the CQL stays the same, explicit marker names remain the names chosen by the application. Changes in synthesized names elsewhere do not rename explicit markers. A schema column rename may require changing the CQL even when its explicit markers stay the same. |
| Positional | Bind type changes | Array positions do not protect against stale bind types. A cached handle still serializes values using its original types. This can cause an error or incorrect values. Create a new `Client` after changing the schema. |
| By name | Bind type changes | Name lookup does not refresh bind types. The same stale-type risk applies as with arrays. Create a new `Client` after changing the schema. |

When a node returns `UNPREPARED` for an evicted prepared statement, the driver
prepares the statement again and retries execution. This refreshes result metadata
when supported. It does **not** refresh the cached handle's bind names or
types. Positional binding remains safe when only a synthesized name changes.
If the client's bounded cache evicts a statement, the driver prepares it again
with new bind metadata on its next use. After a schema change that affects
bind types, create a new `Client`, as described above. Automatic repreparation
alone is not sufficient. Explicit bind-cache invalidation is tracked in
[#624](https://github.com/scylladb/nodejs-rs-driver/issues/624).

:::{caution}
**Ensure sufficient cache size.** If you execute more than `ClientOptions.maxPrepared` different statements, you will experience cache flickering, defeating the purpose of prepared
statements and significantly decreasing driver performance.
:::

```js
function insert(next) {
    const query =
        "INSERT INTO examples.basic (id, txt, val) VALUES (?, ?, ?)";
    // By changing the prepare option, you can decide whether to prepare given statement
    client.execute(query, [id, "Hello!", 100], { prepare: true }, next);
},
```

| Statement comparison | Unprepared                                | Prepared                                                       |
|----------------------|-------------------------------------------|----------------------------------------------------------------|
| Usability            | execute CQL statement string directly     | the driver ensures the statement is prepared before execution  |
| Performance          | poor (statement parsed each time)         | good (statement parsed only upon preparation)                  |
| Load balancing       | primitive (random choice of a node/shard) | advanced (proper node/shard, optimisations for LWT statements) |
| Suitable operations  | one-shot operations                       | repeated operations                                            |

If a statement contains bind markers (`?`), then it needs some values to be passed along the statement string.
If a statement is prepared, the metadata received from the DB can be used to verify validity of passed bind values.
In case of unprepared statements, this metadata is missing and thus verification is not feasible.
While it's possible to [manually provide metadata](./unprepared.md), this allows some silent bugs to sneak into user applications in case the provided metadata is invalid.

<!-- Well. While the rust driver still silently prepares with the goal of ensuring type safety. We just totally ignore the verification part. -->
:::{note}
When an unprepared statement contains bind markers (`?`), the driver silently
prepares the statement before execution. This is especially important in batches:
for each statement with a non-empty list of values in the batch,
the driver will send a prepare request, and it will be done **sequentially**.
Results of preparation are not cached between `client.batch()` calls.

Avoid using unprepared batches unless all statements take no bind markers.
:::

### Single vs [Batch](./batch.md)

The batch statement combines multiple data modification statements (`INSERT`, `UPDATE`, or `DELETE`)
into a single logical operation that is sent to the server in a single request.
By default, batching together multiple operations also ensures that they are executed in an atomic way (that is, either all succeed or none).
Remember that using [unlogged batches](https://docs.scylladb.com/manual/stable/cql/dml/batch.html#unlogged-batches) (which you need to manually enable)
means that your batch is no longer atomic.

| Statement comparison | Single                                                | Batch                                                                                                                                                                               |
|----------------------|-------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Exposed Client API   | `execute`, `eachRow`, `executeConcurrent`             | `batch`                                                                                                                                                                             |
| Usability            | simple setup                                          | need to aggregate statements and binding values to each is more cumbersome                                                                                                          |
| Performance          | good (DB is optimised for handling single statements) | good for small batches, may be worse for larger (also: higher risk of request timeout due to big portion of work)                                                                   |
| Load balancing       | advanced if prepared, else primitive                  | advanced if prepared **and ALL** statements in the batch target the same partition, else primitive                                                                                  |
| Suitable operations  | most operations                                       | - a list of operations that need to be executed atomically (batch LightWeight Transaction)</br> - a batch of operations targeting the same partition (as an advanced optimisation)  |

### [Paged](../paging/paging.md) vs Unpaged queries

SELECT statements return a result set, possibly a large one. Paging is available to fetch it in chunks, relieving load on the cluster and lowering latency.
For SELECTs, avoid unpaged queries. For non-SELECTs, unpaged queries are preferred.

| Query result fetching | Unpaged                                                                                                                 | Paged                                                                                                                                                          |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Exposed Client API    | `execute`, `executeConcurrent`                                                                                          | `eachRow`, `stream`, `ResultSet.asyncIterator`, `execute` with `ResultSet.pageState`                                                                           |
| Usability             | get all results in a single CQL frame, so into a single result set                                                      | need to fetch multiple CQL frames and iterate over them - using driver's abstractions (`eachRow`, `ResultSet.asyncIterator`) or manually (`execute` in a loop) |
| Performance           | - for large results, puts **high load on the cluster**</br> - for small results, the same as paged                      | - for large results, relieves the cluster</br> - for small results, the same as unpaged                                                                        |
| Memory footprint      | potentially big - all results have to be stored at once                                                                 | small - at most constant number of pages are stored by the driver at the same time                                                                             |
| Latency               | potentially big - all results have to be generated at once                                                              | small - at most one chunk of data must be generated at once, so latency of each chunk is small                                                                 |
| Suitable operations   | - in general: operations with empty result set (non-SELECTs)</br> - as possible optimisation: SELECTs with LIMIT clause | - in general: all SELECTs                                                                                                                                      |

For more detailed comparison and more best practices, see doc page about [paging](../paging/paging.md).

## CQL statements - operations (based on what the CQL string contains)

| CQL data manipulation statement                | Recommended statement kind                                                                                                                                           | Should be paged                                                                                                                          |
|------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| SELECT                                         | Prepared statement if repeated, or using more advanced ([unguessable](./unprepared.md#recognizable-types)) parameters in the query, otherwise unprepared  | Yes, unless query guarantees that no more than a few rows will be returned (ex. selecting a single row by searching for its primary key) |
| INSERT, UPDATE                                 | Prepared statement if repeated, unprepared statement if once, batch if multiple statements are to be executed atomically                                             | No. While you can still use paging, it is irrelevant, because the result set of such operation is empty                                  |
| CREATE/DROP {KEYSPACE, TABLE, TYPE, INDEX,...} | Unprepared statement, batch if multiple statements are to be executed atomically                                                                                     | No. While you can still use paging, it is irrelevant, because the result set of such operation is empty                                  |

Executing statements is fully asynchronous, so they can be run in parallel without limitation.
