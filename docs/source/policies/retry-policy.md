# Retry Policies

The driver currently supports only built-in retry policies.

## Default Retry Policy

Used automatically when no other policy is specified.

The default policy retries a request when there is a reasonable chance that retrying will succeed.
Its behavior is based on the
[DataStax Java Driver default retry policy](https://docs.datastax.com/en/developer/java-driver/4.11/manual/core/retries/index.html).

## Fallthrough Retry Policy

Never retries. Returns errors directly to the caller.

Useful for debugging, as it surfaces every error immediately without any automatic retry attempt.

```javascript
const { FallthroughRetryPolicy } = require("scylladb-driver-alpha")
  .policies.retry;

const client = new cassandra.Client({
  contactPoints: ["127.0.0.1:9042"],
  policies: {
    retry: new FallthroughRetryPolicy(),
  },
});
```
