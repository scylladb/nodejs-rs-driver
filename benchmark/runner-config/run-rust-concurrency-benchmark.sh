#!/usr/bin/env bash
# Runner for scenarios where we parametrize concurrency level, rather than number of queries.
# Step count omitted (uses binary default); N passed as concurrency level.
# Usage: run-rust-concurrency-benchmark.sh <binary-name> <concurrency>
set -euo pipefail

BINARY="$1"
CONCURRENCY="$2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../.."

CONCURRENCY="$CONCURRENCY" "$REPO_ROOT/target/release/$BINARY"
