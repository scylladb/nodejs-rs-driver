# Benchmarks for `Scylladb-javascript-driver`

A file that runs all benchmarks: `runner.py`

The script compares benchmark results for our driver, [DataStax Node.js driver](https://github.com/datastax/nodejs-driver) and [Rust driver](https://github.com/scylladb/scylla-rust-driver). Parameters for the benchmarks can be modified inside it. The result is a `graph.png` file that presents a graph of time on a logarithmic scale. The graphs are uploaded to the provided discord webhook.

All benchmarks use the same table name. Running multiple benchmarks on the same database may lead to undefined behaviors.

The script uses an environment variable `SCYLLA_URI` - IP address of the Scylla database. Remember to start a database before.

For example:

```bash
SCYLLA_URI="172.17.0.2:9042" python3 benchmark/runner.py
```

## Benchmarks

Each benchmark recreates the table before execution to ensure consistent and isolated results.

Each of the JS benchmarks has an equivalent in Rust. For JS benchmarks, `driver` parameter determines which driver is tested. It can be `scylladb-driver-alpha` or `cassandra-driver`.

Before running the benchmarks in Rust, remember to build them with flags `--bin -r`.

Concurrent benchmarks in JS first create an array of queries, which are then executed by calling the `executeConcurrent` function.
Rust benchmarks do not create an array to execute the queries. Queries are generated on the fly.

- **concurrent insert**

This benchmark uses `executeConcurrent` endpoint to insert `n` rows containing `uuid` and `int` into the database. Afterwards, it checks that the number of rows inserted is correct.

JS:

```bash
node concurrent_insert.js <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin concurrent_insert_benchmark -r
```

- **insert**

This benchmark executes `n` `client.execute` queries, that insert a single row containing `uuid` and `int` waiting for the result of the previous query before executing the next one.

JS:

```bash
node insert.js <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin insert_benchmark -r
```

- **concurrent_select**

This benchmark first inserts `10` rows containing `uuid` and `int`. Afterwards it uses `executeConcurrent` endpoint to select all of the inserted rows from the database `n` times.

JS:

```bash
node concurrent_select.js <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin concurrent_select_benchmark -r
```

- **select**

This benchmark first inserts 10 rows containing `uuid` and `int`. Afterwards it executes `n` `client.execute` queries, that select all of the inserted rows, waiting for the result of the previous query before executing the next one.

JS:

```bash
node select.js <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin select_benchmark -r
```

- **batch**

This benchmark uses `client.batch` endpoint to insert `n` rows containing `uuid` and `int` into the database. Afterwards, it checks that the number of rows inserted is correct.

JS:

```bash
node batch.js <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin batch_benchmark -r
```
