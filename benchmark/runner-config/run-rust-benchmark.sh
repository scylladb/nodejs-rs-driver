#!/usr/bin/env bash
# Usage: run-rust-benchmark.sh <binary-name> <N>
# Runs the given pre-built Rust benchmark binary and prints elapsed seconds.
set -euo pipefail

BINARY="$1"
N="$2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../.."

START=$(date +%s%N)
CNT="$N" "$REPO_ROOT/target/release/$BINARY"
END=$(date +%s%N)

ELAPSED=$(echo "scale=6; ($END - $START) / 1000000000" | bc)
echo "$ELAPSED"
