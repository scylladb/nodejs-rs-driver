# Logging

The driver uses [events](https://nodejs.org/api/events.html) to expose logging
information, keeping it decoupled from any specific logging framework.

The `Client` class inherits from
[EventEmitter](https://nodejs.org/api/events.html#events_class_eventemitter)
and emits `'log'` events:

```js
client.on('log', (level, target, message, furtherInfo) => {
  console.log(`${level} - ${target}: ${message}`);
});
```

## Enabling logging

Logging is **enabled by default**. When no `logLevel` is specified, events at
`warning` level and above are captured.
We recommend explicitly setting the desired logging level when using this driver.

To choose a specific minimum severity:

```js
const { Client, types } = require('@scylladb/driver');

const client = new Client({
  contactPoints: ['127.0.0.1'],
  logLevel: types.logLevels.info,
});
```

To disable logging entirely, set `logLevel` to `'off'`:

```js
const { Client, types } = require('@scylladb/driver');

const client = new Client({
  contactPoints: ['127.0.0.1'],
  logLevel: types.logLevels.off,
});
```

The callback is registered when `connect()` is called and unregistered on
`shutdown()`. No log events are emitted before the client connects
(with a few exceptions, such as attempting to use the client after shutdown).

## Log levels

Log levels are exposed through the `types.logLevels` enum:

| Enum variant        | Raw value   | Description                                          |
| ------------------- | ----------- | ---------------------------------------------------- |
| `logLevels.trace`   | `'trace'`   | Finest-grained diagnostic information (TRACE events) |
| `logLevels.debug`   | `'debug'`   | Fine-grained diagnostic information (DEBUG events)   |
| `logLevels.info`    | `'info'`    | High-level informational messages                    |
| `logLevels.warning` | `'warning'` | Potentially harmful situations                       |
| `logLevels.error`   | `'error'`   | Error conditions                                     |
| `logLevels.off`     | `'off'`     | Disables logging entirely                            |

The `logLevel` option acts as a **filter**: only events at or above the
configured severity are delivered to the listener. The majority of filtering happens on the
native side, before crossing the FFI boundary, so suppressed events have negligible overhead.

| `logLevel` value    | Events delivered                    |
| ------------------- | ----------------------------------- |
| not set             | WARN and above — **default**        |
| `logLevels.off`     | None                                |
| `logLevels.trace`   | All (TRACE and above)               |
| `logLevels.debug`   | DEBUG and above                     |
| `logLevels.info`    | INFO and above                      |
| `logLevels.warning` | WARN and above                      |
| `logLevels.error`   | ERROR only                          |

The `trace` level is only suitable for debugging and is usually very
noisy. We recommend gathering events from `info` and above in production
environments.

## Event arguments

Each `'log'` event delivers four arguments:

| Argument      | Type     | Description                                                                                                                                     |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `level`       | `string` | One of the level strings from the table above.                                                                                                  |
| `target`      | `string` | Identifies the source of the event. Either a class name (e.g. `"Client"`) or an internal module path (e.g. `"scylla::network::connection"`).    |
| `message`     | `string` | Human-readable description of the event.                                                                                                        |
| `furtherInfo` | `string` | Additional structured context. Some events include key=value pairs from tracing spans (e.g. `peer_addr=10.0.0.1:9042`). May be an empty string. |

### Event sources

Log events are emitted by both the Rust driver core and the JavaScript wrapper.
The `target` field identifies where an event originated — it contains either an
internal module path (e.g. `"scylla::network::connection"`) or a JS class name
(e.g. `"Client"`).

Both sources deliver events through the same `'log'` event, so a single
listener receives everything.

## Multiple clients

Each `Client` registers its own logging callback independently. Multiple
clients can coexist, each with its own `logLevel`.

:::{note}
All clients share the same underlying Rust tracing subscriber.
This means every client receives log events from the entire process —
including events triggered by other `Client` instances. Keep this in mind
when filtering or routing events.
:::

## Example

```js
const { Client, types } = require('@scylladb/driver');

const client = new Client({
  contactPoints: ['10.0.1.101', '10.0.1.102'],
  logLevel: types.logLevels.info,
});

client.on('log', (level, target, message, furtherInfo) => {
  const extra = furtherInfo ? ` (${furtherInfo})` : '';
  console.log(`[${level}] ${target}: ${message}${extra}`);
});

await client.connect();
// [info] Client: Connecting to cluster using 'ScyllaDB Node.js RS Driver' version ...
// [info] scylla::cluster::worker: Node added to cluster: ...
// ...

await client.shutdown();
```
