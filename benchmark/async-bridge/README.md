# Async bridge latency and throughput benchmark

Compare two native libraries with the same JavaScript driver. Use separate
processes and matching release build flags; do not compile during measurement.

## Workloads

- `sparse`: open-loop arrivals, 500 requests/s by default (`RATE`). Reports
  request-start latency, scheduling lateness, and latency from intended arrival.
- `serial`: one outstanding request, immediately followed by the next. This is a
  warm request chain, not an idle-client latency test.
- `throughput`: sustained concurrency 128 by default (`CONCURRENCY`).

`ROWS` selects the result size. Query setup creates `bridge_bench.reads` and a
partition of at least 128 rows with 128-byte values. The partition size is its
key, so a larger-result run cannot change a smaller dataset. Reads are prepared
and include the driver's result construction. `WORKLOADS=bridge` replaces queries
with immediately ready native futures and requires builds with `--features tests`.
Those measurements isolate bridge overhead; they are not database-query speedups.

## Run

Build the baseline in a separate worktree and this branch with `npm run build`.
Use the same Rust compiler, build profile, features and flags for both. The
recorded baseline was `e0f97abb461200b3fb704c73a88aa7aa92c416d1`.

For an isolated database, the recorded runs used:

```sh
docker run -d --name nodejs-bridge-bench --cpuset-cpus 4,6 --memory 4g \
  scylladb/scylla:2026.2.6 --smp 2 --memory 2G --overprovisioned 1 \
  --developer-mode 1 --skip-wait-for-gossip-to-settle 0 --ring-delay-ms 0
```

Set `BENCH_HOST` to that container's address, or to a dedicated existing Scylla
instance. Then, with absolute paths to the two `.node` files:

```sh
BENCH_HOST=172.17.0.14 DURATION=8 WARMUP=2 REPEATS=3 \
  python3 benchmark/async-bridge/compare.py \
  --baseline /tmp/baseline.node --candidate /tmp/candidate.node /tmp/read-results.jsonl
python3 benchmark/async-bridge/summarize.py /tmp/read-results.jsonl
```

The output filename must be new. `SCENARIOS`, `WORKLOADS`, `RATE`, `ROWS` and
`CONCURRENCY` control the workload. For example, use `ROWS=128` for larger results,
`CONCURRENCY=512 SCENARIOS=throughput` for higher concurrency, or
`WORKLOADS=bridge` for the immediate-future comparison.

Optional Linux affinity controls:

```sh
BENCH_CPUS=0,2,8,10 BENCH_PIN_THREADS=1 \
BENCH_JS_CPU=0 BENCH_WORKER_CPUS=2,8 BENCH_BACKGROUND_CPU=10 \
BENCH_HOST=172.17.0.14 python3 benchmark/async-bridge/compare.py \
  --baseline /tmp/baseline.node --candidate /tmp/candidate.node /tmp/pinned-results.jsonl
```

Choose CPUs for the actual machine. Pinning separates benchmark components but
cannot reserve CPUs against other applications. Each child reports readiness
before warmup; the runner pins its threads, then starts the workload.

## Recorded combined-prototype results

These measurements predate the PR split. They compare the complete implementation
(low-load first polling/direct delivery **plus** load-sized drains) with the
baseline above. They do not isolate the incremental effect of the drain change.
The current stack additionally batches pending low-load completions and retains
completion results through shutdown. These historical measurements do not measure
that updated implementation; rerun the comparisons before attributing the recorded
results to the current stack.

Environment: Node.js 24.16.0, Rust 1.98.1, Linux, Intel i7-13700H, a local two-shard
ScyllaDB 2026.2.6 container with 2 GiB, on a shared workstation. JavaScript used
CPU 0, Tokio 2/8, background/V8 10, and Scylla 4/6. Query comparisons used release
builds without test features; immediate-future comparisons used test features.

The main comparisons use three runs and two-second warmup. Single-row sparse,
serial and concurrency-128 samples measure eight seconds; concurrency-512 and
128-row samples measure six seconds. Supplementary rates use two six-second
runs. Microbenchmarks use two three-second runs after one-second warmup.

Medians of the main comparisons:

| Workload | Baseline → combined ops/s | Baseline → combined p50 µs | Baseline → combined p99 µs |
|---|---:|---:|---:|
| 1 row, sparse 500/s | 500 → 500 | 234.0 → 279.3 | 2267.1 → 2207.7 |
| 1 row, warm serial | 13989 → 16010 | 69.9 → 48.0 | 148.6 → 168.3 |
| 1 row, concurrency 128 | 58558 → 82383 | 2083.8 → 1134.6 | 8675.3 → 10207.2 |
| 1 row, concurrency 512 | 87138 → 87342 | 4603.9 → 4653.1 | 26460.2 → 25673.7 |
| 128 rows, sparse 500/s | 500 → 500 | 638.0 → 637.4 | 1927.2 → 2048.0 |
| 128 rows, concurrency 128 | 14740 → 14893 | 8585.2 → 8503.3 | 11583.5 → 11370.5 |

Single-row concurrency 128 gains about 41% throughput, but CPU rises from 0.84 to
1.32 cores and p99 worsens about 18%. Warm serial median improves about 31%, but
serial p99 does not improve. Sparse-query tails show no consistent win across
100, 500 and 1000 requests/s. This is a throughput/median tradeoff, not a proven
fix for unloaded database-query latency.

A fixed 64-result/50-µs drain previously increased p99 at concurrency 512 from
about 26 ms to 48 ms. Enlarging drains under high load recovered approximately
baseline behavior. The larger budget does not wait for a batch to fill.

[Raw samples](prototype-results.jsonl) retain the measurements and source-run
labels, with process IDs removed. [Detailed summaries](prototype-summary.md)
include run ranges and supplementary rates/microbenchmarks.
[Environment metadata](prototype-environment.json) records the baseline and image.
Summaries take medians across runs; they do not pool or average percentiles.
