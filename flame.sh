#!/bin/bash
set -euo pipefail

# Configuration
: "${BENCH:=concurrent_insert}"
: "${DRIVER=cassandra-driver}"
: "${SCYLLA_URI=172.42.0.2:9042}"
: "${N=62500}" # Number of operations to perform
NODE_FLAGS="--perf-basic-prof --interpreted-frames-native-stack"
OUTPUT_DIR="flamegraph"
PERF_DATA="perf.data"
PERF_FREQ=10000 # Frequency of perf sampling, in Hz
SVG_OUTPUT="flamegraph-${BENCH}-${DRIVER}.svg"
WIDTH=1000 # Width of the generated SVG

# Make sure FlameGraph tools are in PATH or set the path manually
FLAMEGRAPH_DIR="${FLAMEGRAPH_DIR:-$HOME/Repos/flame}"  # Modify if needed

# Check required tools
command -v perf >/dev/null || { echo "perf is not installed."; exit 1; }
[ -x "$FLAMEGRAPH_DIR/stackcollapse-perf.pl" ] || { echo "FlameGraph tools not found in $FLAMEGRAPH_DIR."; exit 1; }

# Create output directory
mkdir -p "$OUTPUT_DIR"
cd "$OUTPUT_DIR" || exit 1

# If DRIVER is 'rust-driver', launch the Rust driver with cargo
if [ "$DRIVER" = "rust-driver" ]; then
    echo "Launching Rust driver benchmark with perf record..."
    cargo build --profile=perf --bin="$BENCH"_benchmark
    echo "Command executed: SCYLLA_URI=$SCYLLA_URI CNT=$N sudo /usr/bin/time -v perf record -F $PERF_FREQ -g -- cargo run --release --bin=${BENCH}_benchmark"
    sudo SCYLLA_URI=$SCYLLA_URI CNT=$N /usr/bin/time -v perf record -F $PERF_FREQ -g -- ../target/release/${BENCH}_benchmark
else
    echo "Launching Node.js benchmark with perf record..."
    echo "Command executed: SCYLLA_URI=$SCYLLA_URI NODE_ENV=production sudo /usr/bin/time -v perf record -F $PERF_FREQ -g -- node ${NODE_FLAGS} \"../benchmark/logic/$BENCH.js\" $DRIVER $N"
    sudo SCYLLA_URI=$SCYLLA_URI NODE_ENV=production /usr/bin/time -v perf record -F $PERF_FREQ -g -- node ${NODE_FLAGS} "../benchmark/logic/$BENCH.js" $DRIVER $N
fi

echo "Generating FlameGraph..."
sudo perf script > out.perf
"$FLAMEGRAPH_DIR/stackcollapse-perf.pl" out.perf > out.folded
"$FLAMEGRAPH_DIR/flamegraph.pl" --width $WIDTH out.folded > "$SVG_OUTPUT"

SPEEDSCOPE_OUTPUT="${SVG_OUTPUT%.svg}.speedscope.folded"
cp out.folded "$SPEEDSCOPE_OUTPUT"

speedscope $SPEEDSCOPE_OUTPUT

# echo "✅ Flamegraph generated: $OUTPUT_DIR/$SVG_OUTPUT"
# firefox "$SVG_OUTPUT" &
