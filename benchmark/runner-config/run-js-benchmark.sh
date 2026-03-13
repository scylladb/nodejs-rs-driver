#!/usr/bin/env bash
# Usage: run-js-benchmark.sh <benchmark-js> <driver> <N>
# Runs the given JS benchmark and prints the elapsed wall-clock time in seconds.
set -euo pipefail

BENCHMARK="$1"
DRIVER="$2"
N="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARK_DIR="$SCRIPT_DIR/.."

START=$(date +%s%N)
node "$BENCHMARK_DIR/logic/$BENCHMARK" "$DRIVER" "$N"
END=$(date +%s%N)

ELAPSED=$(echo "scale=6; ($END - $START) / 1000000000" | bc)
echo "$ELAPSED"
