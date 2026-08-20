# Query Tracing

Tracing is a feature provided by Scylla. When sending a query we can set a flag that signifies that we would like it to be traced. After completing the query ScyllaDB provides a tracing_id which can be used to fetch information about it - which nodes it was sent to, what operations were performed etc.

## Enabling tracing for a query

Set `traceQuery: true` in the query options:

```javascript
const result = await client.execute(
    'SELECT * FROM examples.tbl WHERE id = ?',
    [id],
    { traceQuery: true, prepare: true },
);
```

The id of the recorded trace session is reported on the result:

```javascript
const traceId = result.info.traceId; // a types.Uuid, or null if the query was not traced
```

## Retrieving the trace

Pass that id to `client.metadata.getTrace()`:

```javascript
const trace = await client.metadata.getTrace(traceId);
```

The server writes tracing data **asynchronously**, so a trace is not guaranteed to be readable the
instant the traced query returns. `getTrace()` accounts for this by retrying a few times. `getTrace()`
also supports the callback style used elsewhere in the driver:

```javascript
client.metadata.getTrace(traceId, function (err, trace) {
    if (err) {
        return console.error(err);
    }
    console.log(trace.requestType);
});
```
