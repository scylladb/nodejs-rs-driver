<!-- This document is heavily based on the rust driver documentation:
https://rust-driver.docs.scylladb.com/stable/statements/statements.html 
and DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/coding-rules/index.html -->

# Executing CQL statements - best practices

Driver supports all kinds of statements supported by ScyllaDB. The following tables aim to bridge between DB concepts and driver's API.
They include recommendations on which API to use in what cases.

## Kinds of CQL statements (from the CQL protocol point of view)

| Kind of CQL statement | Single               | Batch                                |
|-----------------------|----------------------|--------------------------------------|
| prepared              | prepared statement   | batch of prepared statements         |
| unprepared            | unprepared statement | batch of unprepared statements       |

This is **NOT** strictly related to content of the CQL statement string.

> ***Interesting note***\
> In fact, any kind of CQL statement could contain any CQL statement string.
> Yet, some of such combinations don't make sense and will be rejected by the DB.
> For example, SELECTs in a Batch are nonsense.

### [Unprepared](./unprepared_statements.md) vs Prepared

> ***GOOD TO KNOW***\
> Each time a statement is executed by sending a statement string to the DB, it needs to be parsed. Driver does not parse CQL, therefore it sees statement strings as opaque.\
> There is an option to *prepare* a statement, i.e. parse it once by the DB and associate it with an ID. After preparation, it's enough that the driver sends the ID
> and the DB already knows what operation to perform - no more expensive parsing necessary! Moreover, upon preparation driver receives valuable data for load balancing,
> enabling advanced load balancing (so better performance!) of all further executions of that prepared statement.\
> ***Key takeaway:*** always use prepared statements that you are going to execute multiple times.

You can decide whether a given query will be prepared by setting the `QueryOptions.prepare` option. By default, queries are unprepared.
You do not need to manually handle statement preparation. If you enable the `prepare` option, the driver handles the rest: it either uses its cache of prepared statements
if the statement is present, or prepares the query before execution.
The driver keeps a cache of the last `ClientOptions.maxPrepared` statements. This cache ensures you can take full advantage of prepared statements.

:::{warning}
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
While it's possible to [manually provide metadata](./unprepared_statements.md), this allows some silent bugs to sneak into user applications in case the provided metadata is invalid.

<!-- Well. While the rust driver still silently prepares with the goal of ensuring type safety. We just totally ignore the verification part. -->
:::{warning}
When the unprepared statement contains bind markers, the driver silently prepares the statement before execution.
That behaviour is especially important in batches:
For each simple statement with a non-empty list of values in the batch,
the driver will send a prepare request, and it will be done **sequentially**!
Results of preparation are not cached between `client.batch` calls.

Takeaway from the above: Do NOT use unprepared batches, unless all statements take no bind markers.
:::

### Single vs Batch

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

### Paged vs Unpaged queries

> ***GOOD TO KNOW***\
> SELECT statements return a result set, possibly a large one. Therefore, paging is available to fetch it in chunks, relieving load on the cluster and lowering latency.\
> ***Key takeaways:***\
> For SELECTs you had better **avoid unpaged queries**.\
> For non-SELECTs, it's preferred to have unpaged queries.

| Query result fetching | Unpaged                                                                                                                 | Paged                                                                                                                                                          |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Exposed Client API    | `execute`, `executeConcurrent`                                                                                          | `eachRow`, `stream`, `ResultSet.asyncIterator`, `execute` with `ResultSet.pageState`                                                                           |
| Usability             | get all results in a single CQL frame, so into a single result set                                                      | need to fetch multiple CQL frames and iterate over them - using driver's abstractions (`eachRow`, `ResultSet.asyncIterator`) or manually (`execute` in a loop) |
| Performance           | - for large results, puts **high load on the cluster**</br> - for small results, the same as paged                      | - for large results, relieves the cluster</br> - for small results, the same as unpaged                                                                        |
| Memory footprint      | potentially big - all results have to be stored at once                                                                 | small - at most constant number of pages are stored by the driver at the same time                                                                             |
| Latency               | potentially big - all results have to be generated at once                                                              | small - at most one chunk of data must be generated at once, so latency of each chunk is small                                                                 |
| Suitable operations   | - in general: operations with empty result set (non-SELECTs)</br> - as possible optimisation: SELECTs with LIMIT clause | - in general: all SELECTs                                                                                                                                      |

## CQL statements - operations (based on what the CQL string contains)

| CQL data manipulation statement                | Recommended statement kind                                                                                                                                           | Should be paged                                                                                                                          |
|------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| SELECT                                         | Prepared statement if repeated, or using more advanced ([unguessable](./unprepared_statements.md#recognizable-types)) parameters in the query, otherwise unprepared  | Yes, unless query guarantees that no more than a few rows will be returned (ex. selecting a single row by searching for its primary key) |
| INSERT, UPDATE                                 | Prepared statement if repeated, unprepared statement if once, batch if multiple statements are to be executed atomically                                             | No. While you can still use paging, it is irrelevant, because the result set of such operation is empty                                  |
| CREATE/DROP {KEYSPACE, TABLE, TYPE, INDEX,...} | Unprepared statement, batch if multiple statements are to be executed atomically                                                                                     | No. While you can still use paging, it is irrelevant, because the result set of such operation is empty                                  |

### Queries are fully asynchronous - you can run as many of them in parallel as you wish
