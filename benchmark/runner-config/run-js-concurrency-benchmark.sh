#!/usr/bin/env bash
# Runner for scenarios where we parametrize concurrency level, rather than number of queries.
# Wrapper for fixed-query-count benchmarks where step count controls concurrency.
# Usage: run-js-concurrency-benchmark.sh <benchmark-name> <driver> <concurrency>
set -euo pipefail

BENCHMARK="$1"
DRIVER="$2"
CONCURRENCY="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARK_DIR="$SCRIPT_DIR/.."

# Step count omitted (uses module default); N passed as concurrency level.
node "$BENCHMARK_DIR/logic/benchmark.js" "$DRIVER" "$BENCHMARK" "default" "$CONCURRENCY"
