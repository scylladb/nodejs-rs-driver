# `eachRow()` paging benchmark

This benchmark measures the paging path changed in #599. It creates a temporary
keyspace and a single 500-row partition, then reads it repeatedly with
`eachRow()` and automatic paging. Both prepared and unprepared queries use a
4 KiB partition key so repeated input encoding is visible. Setup and warmup
are excluded from timings. The keyspace is dropped when the run finishes.

Run against a ScyllaDB node and two built driver checkouts. Use the same node,
native binary, and settings for both runs. For example:

```sh
DRIVER_ROOT=/path/to/before CONTACT_POINT=127.0.0.1:9042 node benchmark/each-row-paging.js
DRIVER_ROOT=/path/to/after CONTACT_POINT=127.0.0.1:9042 node benchmark/each-row-paging.js
```

Set `LOCAL_DATA_CENTER` if the driver cannot discover the local data center.
`ROWS`, `FETCH_SIZE`, `WARMUPS`, and `RUNS` default to `500`, `10`, `5`, and
`30`. `FETCH_SIZE` must be smaller than `ROWS`. Output is one JSON object with
mean, median, and 95th percentile latency in milliseconds, plus rows per second.
Run the two revisions in alternating order to check for host or database drift.

The benchmark creates and drops a keyspace. Use a disposable ScyllaDB instance
if the target cluster is shared.
