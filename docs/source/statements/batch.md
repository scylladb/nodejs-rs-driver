<!-- This document is heavily based on the DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/features/batch/index.html
and rust driver documentation:
https://rust-driver.docs.scylladb.com/stable/statements/batch.html -->

# Batch Statements

It's common for applications to require atomic batching of multiple `INSERT`, `UPDATE`, or `DELETE` statements, even in
different partitions or column families. The driver allows you to execute multiple statements atomically
without the need to concatenate multiple queries.

:::{note}
Batches containing statements that target different partitions will no longer
be correctly token- and shard-aware, which will hurt performance.
Batches should not normally be used to boost performance in ScyllaDB.
Batches' goal is enabling atomicity, not increased efficiency.
If you want to execute multiple statements efficiently and you do not
care about atomicity of the operation, we would recommend using `executeConcurrent` endpoint.
:::

The method `batch()` accepts the list of queries as first parameter.
Each query can be either just a statement string, or `{ query, params }` object:

```javascript
const query1 = 'INSERT INTO user_profiles (email) VALUES (\'example@example.com\`)';
const query2 = 'UPDATE user_profiles SET email = ? WHERE key = ?';
const query3 = 'INSERT INTO user_track (key, text, date) VALUES (?, ?, ?)';
const queries = [
  query1,
  { query: query2, params: [emailAddress, 'hendrix'] },
  { query: query3, params: ['hendrix', 'Changed email', new Date()] }
];
// Promise-based call
client.batch(queries, { prepare: true })
  .then(function() {
    // All queries have been executed successfully
  })
  .catch(function(err) {
    // None of the changes have been applied
  });
```

Or using the callback-based invocation

```javascript
client.batch(queries, { prepare: true }, function (err) {
   // All queries have been executed successfully
   // Or none of the changes have been applied, check err
});
```

By preparing your statements, you will get the best performance and your JavaScript parameters correctly mapped to
Cassandra types. The driver will prepare each statement once on each host and execute the batch every time with the
different parameters provided.

:::{note}
When an unprepared statement contains bind markers (`?`), the driver silently
prepares the statement before execution. This is especially important in batches: for each
statement with a non-empty list of values, the driver sends a prepare request **sequentially**,
and results are **not cached** between `client.batch()` calls.

Avoid using unprepared batches unless all statements take no bind markers.
:::

Note that batches are not suitable for bulk loading, there are dedicated tools for that. Batches allow you
to group related updates in a single request, so keep the batch size small (in the order of tens).
Refer to [CQL documentation][batches] for information about correct and incorrect use of batches.

[batches]: https://docs.scylladb.com/manual/stable/cql/dml/batch.html
