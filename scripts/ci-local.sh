#!/usr/bin/env bash
# Runs (most of) what CI runs, locally, in the order of the workflows it mirrors:
# code-quality.yml, check-docs.yml, typescript-tests.yml, unit-tests.yml,
# integration-tests.yml, examples.yml. Builds are consolidated (one debug+test build,
# one release build) since CI's per-workflow rebuilds only exist for its arch matrix.
#
# integration-tests need CCM_PATH pointing at a scylla-ccm checkout; examples need
# SCYLLA_URI pointing at a reachable cluster (e.g. `docker compose -f
# .github/docker-compose.yml up -d --wait`, matching what examples.yml itself spins up).
# Both sections are skipped, not failed, when their env var isn't set.
#
# CI also runs both against Apache Cassandra, and so does this script:
#   CUSTOM_JAVA_HOME  a JDK 8, which is what CCM starts Cassandra nodes under no matter
#                     what is on PATH, so the Cassandra integration tests need it
#   CASSANDRA_URI     a reachable Cassandra cluster for the examples, e.g.
#                     `docker compose -f .github/docker-compose-cassandra.yml up -d --wait`
#                     then CASSANDRA_URI=172.43.0.2:9042
# Both are likewise skipped rather than failed when unset.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

# ---- code-quality.yml ----
step "cargo fmt"; cargo fmt --check
step "cargo clippy"; cargo clippy --all-targets --all-features -- -D warnings

# lib/*.js and lib/*.d.ts are tsc output emitted in place next to their .ts source
# (gitignored - see lib/.gitignore) and only exist locally once something has built the
# project before. A fresh CI checkout never has them at this point, so prettier there
# only ever checks source; clean them first to compare against the same set of files.
step "clean previous build output"; git clean -fdX lib/

step "prettier"; npx prettier "{lib,examples,test}/**/*.{js,ts}" --check
step "eslint"; npm run eslint
step "typecheck"; npm run typecheck

step "build (debug + test features)"; npm run build:test

# ---- unit-tests.yml ----
step "unit"; npm run unit
step "unit-gc"; npm run unit-gc
step "unit-not-supported"; npm run unit-not-supported

# ---- integration-tests.yml ----

# Each server's variables are cleared for the other, so that whatever is exported in the
# shell to drive one section cannot leak into the other. A stray CCM_VERSION during the
# Scylla runs asks CCM for a Scylla release numbered after a Cassandra one, and no cluster
# starts.
step "integration"
env -u CCM_VERSION -u CCM_INSTALL_DIR CCM_IS_SCYLLA=true CCM_PATH=../scylla-ccm \
  npm run integration
step "integration-gc"
env -u CCM_VERSION -u CCM_INSTALL_DIR CCM_IS_SCYLLA=true CCM_PATH=../scylla-ccm \
  npm run integration-gc

# Leaving CCM_IS_SCYLLA unset is what selects Cassandra; CCM_VERSION names the release CI
# pins, and CCM downloads it on first use into ~/.ccm/repository, from an archive that is
# throttled hard enough to take about a quarter of an hour.
if [[ -n "${CUSTOM_JAVA_HOME:-}" ]]; then
  cassandra_conf="${HOME}/.ccm/repository/4.1.12/conf/cassandra.yaml"
  if [[ ! -f "$cassandra_conf" ]]; then
    # Creating a throwaway cluster is what makes CCM download the release; the cluster
    # itself is never populated or started. This is the slow first run.
    step "download Apache Cassandra 4.1.12 into the CCM repository"
    rm -rf /tmp/download.ccm && mkdir -p /tmp/download.ccm
    env -u CCM_IS_SCYLLA -u CCM_INSTALL_DIR \
      ccm create download -v 4.1.12 --config-dir=/tmp/download.ccm
    rm -rf /tmp/download.ccm
  fi
  # The same rewrites the CI action applies, so a local run matches it. Cassandra ships
  # materialized views off while the metadata tests use them, and CCM and two suites write
  # pre-4.0 option names, which 4.x rejects when the shipped config carries the new
  # spelling of the same option. All three rewrites are idempotent.
  step "configure the Cassandra CCM repository"
  sed -ri \
    -e 's/^materialized_views_enabled:.*/enable_materialized_views: true/' \
    -e 's/^commitlog_sync_period:.*/commitlog_sync_period_in_ms: 10000/' \
    -e 's/^batch_size_warn_threshold:.*/batch_size_warn_threshold_in_kb: 5/' \
    "$cassandra_conf"
  # CCM_INSTALL_DIR is cleared as well: with it set, CCM takes its config from that tree
  # instead of the repository patched just above, and the node fails to start.
  step "integration (cassandra)"
  env -u CCM_IS_SCYLLA -u CCM_INSTALL_DIR CCM_PATH=../scylla-ccm CCM_VERSION=4.1.12 \
    npm run integration
  step "integration-gc (cassandra)"
  env -u CCM_IS_SCYLLA -u CCM_INSTALL_DIR CCM_PATH=../scylla-ccm CCM_VERSION=4.1.12 \
    npm run integration-gc
else
  step "integration cassandra (skipped: set CUSTOM_JAVA_HOME to a JDK 8 to run)"
fi

step "build (release)"; npm run build

# ---- typescript-tests.yml ----
step "typescript-tests"; npm run typescript-tests

# ---- examples.yml ----
if [[ -n "${SCYLLA_URI:-}" ]]; then
  step "examples"
  (cd examples && npm i) && env -u SKIP_VECTOR_EXAMPLES npm run examples
else
  step "examples (skipped: set SCYLLA_URI to a reachable cluster to run)"
fi

# The examples read their contact point from SCYLLA_URI whichever server they run against.
# The vector examples are skipped because Cassandra 4.1 has no vector type.
if [[ -n "${CASSANDRA_URI:-}" ]]; then
  step "examples (cassandra)"
  (cd examples && npm i) \
    && SCYLLA_URI="$CASSANDRA_URI" SKIP_VECTOR_EXAMPLES=true npm run examples
else
  step "examples cassandra (skipped: set CASSANDRA_URI to a reachable cluster to run)"
fi

step "all done"


# ---- check-docs.yml ----
step "js-doc"; npm run js-doc
step "Sphinx"; make -C docs setupenv test
