<!-- This document is heavily based on the DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/features/parameterized-queries/index.html -->

# Parameterized queries

You can bind the values of parameters in a statement either by _position_ or by using _named_ markers.

## Positional parameterized statements

When using positional parameters, the query parameters must be provided as an Array.

```javascript
const statement = 'INSERT INTO artists (id, name) VALUES (?, ?)';
// Parameters by marker position
const params = ['krichards', 'Keith Richards'];
await client.execute(statement, params, { prepare: true });
```

## Named parameterized statements

You declare the named markers in your queries and use JavaScript object properties to define the parameters, with
the `Object` property names matching the parameter names.

```javascript
const statement = 'INSERT INTO artists (id, name) VALUES (:id, :name)';
// Parameters by marker name
const params = { id: 'krichards', name: 'Keith Richards' };
await client.execute(statement, params, { prepare: true });
```

Named parameters are case-insensitive.

Currently named parameters are supported only in prepared statements.

## Large params

The driver encodes the params of each request into one buffer.
A batch puts the params of all its statements into one buffer.
The buffer grows when the params need more room, and each `Client` keeps it for the next request,
but only up to a cap. The default cap is 64 KiB.

When the params of a request need more than the cap, the driver allocates a larger buffer for this request only.
After the request, it frees that buffer, and starts again with a buffer of 4 KiB.
So if such requests are frequent, each of them allocates new memory, and garbage collection has more work.

To keep a larger buffer, set `encoding.maxRetainedParamsBufferSize` to at least the size of the params
of your frequent large requests:

```javascript
const client = new Client({
  contactPoints: ['127.0.0.1'],
  encoding: { maxRetainedParamsBufferSize: 256 * 1024 }, // 256 KiB
});
```

The value must be an integer from 4096 (smallest buffer size) to 2147483647 (max 32-bit signed integer, native protocol's cap).

### Size of the params

The size of the params is approximately the sum of:

- the size of each encoded value, for example 4 bytes for an `int`, 16 bytes for a `uuid`,
  the UTF-8 length of a `text`, or the length of a `blob`,
- 4 bytes for each value,
- 2 bytes for each statement.

For example, `INSERT INTO images (id, data) VALUES (?, ?)` with a `uuid` and a `blob` of 100,000 bytes
needs 2 + (4 + 16) + (4 + 100,000) = 100,026 bytes.

You do not need an exact number, because the driver measures it for you.
The first time the params of a request need more than the cap, the `Client` logs a warning with their size:

```text
The params of a request need 100026 bytes, more than encoding.maxRetainedParamsBufferSize (65536 bytes).
For each such request, the driver allocates a new buffer. If such requests are frequent,
set encoding.maxRetainedParamsBufferSize to at least their size.
The driver logs this warning once for each Client.
```

The `Client` logs it at the `warning` level.
See [Logging](../logging/logging.md) to receive the logs of the driver.

### Memory cost

Each `Client` keeps one such buffer.
The buffer grows only when a request needs more room, but it does not shrink after that.
In other words, each `Client` can keep up to the cap in memory.

The cap does not limit the size of the params: requests with larger params still work.
