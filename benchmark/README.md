# Benchmarks for `Scylladb-javascript-driver`

There are two tools used for running benchmarks. All benchmarks described below can be run with both runners.

## Drivers Benchmarker

All results from the benchmarks run are stored in a local database file. If you want to use this tool
across multiple repositories, remember to point to the same database file to share the same data.

This tool is still in development, and simplification of running instructions is one of the important todo items.

### Configuration

There are two kinds of configuration, benchmark and backend configurations. Benchmark configuration defines the benchmark - like select,
paging, and so on... To see what can be configured, go to [this config](./runner-config/config.yml).
Backend config specifies for a single driver how to run all kinds of benchmarks. See [example config](./runner-config/rust-driver/config.yml) how to configure it.

The `run-*-benchmark.sh` is a bandage to match the existing format of running benchmarks with the benchmarker expectations.
You can always provide a direct command. The N - number of steps will be provided as last argument to your command.

### Running

Currently you can run only a single benchmark with a single command.

```bash
benchmarker-binary -d <database-file> run <benchmark-name> \
  -b <benchmark-config> \
  -B <backend-config> <time/perf-stat>
```

For example, assuming you have benchmarker directory next to this repo:

```bash
../scylladb-drivers-benchmarker/target/release/scylladb-drivers-benchmarker -d results.db run concurrent_insert \
  -b benchmark/runner-config/config.yml \
  -B benchmark/runner-config/rust-driver/config.yml perf-stat
```

### Plotting

Plotting command:

```bash
benchmarker-binary -d <database-file> plot <benchmark-name> \
  -b <benchmark-config> \
  --series <backend-name>@<folder-containing-backend-config>:<commit-hash>=<alias> \
<series / perf-stat -e counter-names>
```

Example perf command. `""` means no alias (the information after `@` in the description box):

```bash
../scylladb-drivers-benchmarker/target/release/scylladb-drivers-benchmarker -d results.db plot concurrent_insert \
  -b benchmark/runner-config/config.yml \
  --series scylladb-driver@benchmark/runner-config/scylladb-driver:13b9ebc9f3e00150f4804615a5bf52a23ca1e80c=baseline \
  --series scylladb-driver@benchmark/runner-config/scylladb-driver:98b4967aa3b1ff5c90a57e64c6403f01384a7053=custom-async \
  --series cassandra-driver@benchmark/runner-config/cassandra-driver:13b9ebc9f3e00150f4804615a5bf52a23ca1e80c="" \
  --series rust-driver@benchmark/runner-config/rust-driver:13b9ebc9f3e00150f4804615a5bf52a23ca1e80c="" \
perf-stat -e cpu_core/instructions/u
```

Result will be saved to `out.svg`. You can read more in the benchmarker documentation.

## Legacy python script

This script is no longer updated, so it may be broken.

A file that runs all benchmarks: `runner.py`

The script compares benchmark results for our driver, [Cassandra driver](https://github.com/apache/cassandra-nodejs-driver) and [Rust driver](https://github.com/scylladb/scylla-rust-driver). Parameters for the benchmarks can be modified inside it. The result is a `graph.png` file that presents a graph of time on a logarithmic scale. The graphs are uploaded to the provided discord webhook.

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
node benchmark.js concurrent_insert <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin concurrent_insert_benchmark -r
```

- **insert**

This benchmark executes `n` `client.execute` queries, that insert a single row containing `uuid` and `int` waiting for the result of the previous query before executing the next one.

JS:

```bash
node benchmark.js insert <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin insert_benchmark -r
```

- **concurrent_select**

This benchmark first inserts `10` rows containing `uuid` and `int`. Afterwards it uses `executeConcurrent` endpoint to select all of the inserted rows from the database `n` times.

JS:

```bash
node benchmark.js concurrent_select <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin concurrent_select_benchmark -r
```

- **select**

This benchmark first inserts 10 rows containing `uuid` and `int`. Afterwards it executes `n` `client.execute` queries, that select all of the inserted rows, waiting for the result of the previous query before executing the next one.

JS:

```bash
node benchmark.js select <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin select_benchmark -r
```

- **concurrent deserialization**

This benchmark uses `executeConcurrent` endpoint to insert `n` rows containing `uuid`, `int`, `timeuuid`, `inet`, `date`, `time` into the database.  Afterwards it uses `executeConcurrent` endpoint to select all (`n`) of the inserted rows from the database `n` times.

JS:

```bash
node benchmark.js concurrent_deser <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin concurrent_deser_benchmark -r
```

- **deserialization**

This benchmark executes `n` `client.execute` queries, that insert a single row containing `uuid`, `int`, `timeuuid`, `inet`, `date`, `time` waiting for the result of the previous query before executing the next one. Afterwards it executes `n` `client.execute` queries, that select all (`n`) of the inserted rows, waiting for the result of the previous query before executing the next one.

JS:

```bash
node benchmark.js deser <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin deser_benchmark -r
```

- **concurrent serialization**

This benchmark uses `executeConcurrent` endpoint to insert `n*n` rows containing `uuid`, `int`, `timeuuid`, `inet`, `date`, `time` into the database.

JS:

```bash
node benchmark.js concurrent_ser <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin concurrent_ser_benchmark -r
```

- **serialization**

This benchmark executes `n*n` `client.execute` queries, that insert a single row containing `uuid`, `int`, `timeuuid`, `inet`, `date`, `time` waiting for the result of the previous query before executing the next one.

JS:

```bash
node benchmark.js ser <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin ser_benchmark -r
```

- **batch**

This benchmark uses `client.batch` endpoint to insert `n` rows containing `uuid` and `int` into the database. Afterwards, it checks that the number of rows inserted is correct.

JS:

```bash
node benchmark.js batch <driver> <Number of queries>
```

Rust:

```bash
CNT=<Number of queries> cargo run --bin batch_benchmark -r
```
