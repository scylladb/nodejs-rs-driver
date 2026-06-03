# Retry policies

Currently the driver supports only built-in policies. This includes the following policies:

<!-- TODO: This is a very brief documentation, but this is what the rust driver provides...
https://github.com/scylladb/scylla-rust-driver/tree/main/docs/source/retry-policy.
There appears to be an issue to address this fact:
https://github.com/scylladb/scylla-rust-driver/issues/1285
We should update this documentation, when the rust driver updates it's docs.
 -->

- Default retry policy (used if no other policy is specified):

    It retries when there is a high chance that it might help.
    This policy is based on the one in [DataStax Java Driver](https://docs.datastax.com/en/developer/java-driver/4.11/manual/core/retries/index.html). The behavior is the same.

- Falthrough retry policy:

    Never retries, returns errors straight to the user. Useful for debugging
