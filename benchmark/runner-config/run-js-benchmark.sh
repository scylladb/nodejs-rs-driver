#!/usr/bin/env bash
# Wrapper on the command for benchmark runner
# Usage: run-js-benchmark.sh <benchmark-js> <driver> <N>
set -euo pipefail

BENCHMARK="$1"
DRIVER="$2"
N="$3"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCHMARK_DIR="$SCRIPT_DIR/.."

node "$BENCHMARK_DIR/logic/$BENCHMARK" "$DRIVER" "$N"
