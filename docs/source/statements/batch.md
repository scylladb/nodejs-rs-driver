<!-- This document is heavily based on the DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/features/batch/index.html
and rust driver documentation:
https://rust-driver.docs.scylladb.com/stable/statements/batch.html -->

# Batch statements

It's common for applications to require atomic batching of multiple `INSERT`, `UPDATE`, or `DELETE` statements, even in
different partitions or column families. The driver allows you to execute multiple statements atomically
without the need to concatenate multiple queries.

> ***Warning***\
Batches containing statements that target different partitions will no longer
be correctly token- and shard-aware, which will hurt performance.
Batches should not normally be used to boost performance in ScyllaDB.
Batches' goal is enabling atomicity, not increased efficiency.
If you want to execute multiple statements efficiently and you do not
care about atomicity of the operation, we would recommend using `executeConcurrent` endpoint.

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

By preparing your queries, you will get the best performance and your JavaScript parameters correctly mapped to
Cassandra types. The driver will prepare each query once on each host and execute the batch every time with the
different parameters provided.

> ***Warning***\
> Using unprepared statements with bind markers in batches is strongly discouraged.
> For each unprepared statement with a non-empty list of values in the batch,
> the driver will send a prepare request, and it will be done **sequentially**.
> Results of preparation are not cached between `batch` calls.
> Consider preparing the statements before putting them into the batch.

Note that batches are not suitable for bulk loading, there are dedicated tools for that. Batches allow you
to group related updates in a single request, so keep the batch size small (in the order of tens).
Refer to [CQL documentation][batches] for information about correct and incorrect use of batches.

[batches]: https://docs.scylladb.com/manual/stable/cql/dml/batch.html
