#!/usr/bin/env bash
# Measures the code coverage of both layers of the driver -- the JavaScript API
# (main.js and lib/) and the Rust N-API addon (src/) -- as exercised by the test
# suites, and writes one lcov report per layer:
#
#   coverage/js/lcov.info    HTML report in coverage/js/lcov-report/
#   coverage/rust/lcov.info  HTML report in coverage/rust/html/
#
# The suites are the ones the unit and integration workflows run: unit, unit-gc
# and unit-not-supported, then integration and integration-gc against a CCM
# cluster (see "Test dependencies" in CONTRIBUTING.md for what those need, and
# set CCM_IS_SCYLLA=true to run them against ScyllaDB). --unit-only skips the two
# integration suites, for a machine without CCM; CI never passes it. The Rust
# unit tests (cargo test --lib), which the unit workflow also runs, are left
# out: their #[cfg(test)] modules sit inline in src/, so they would count their
# own lines as covered, which the report cannot leave out on a stable
# toolchain, and the JS suites already call the helpers they test.
#
# The JS layer is measured with V8's own coverage (NODE_V8_COVERAGE, reported by
# c8), so the sources run unmodified; the TypeScript in lib/ is recompiled with
# inline source maps, so the report names the .ts sources rather than the
# untracked .js that tsc emits next to them. The Rust layer is built with LLVM's
# source-based coverage (cargo llvm-cov show-env, then napi build) and reported
# by cargo llvm-cov. That addon goes into coverage/addon/, not in place of the
# build in the tree, which this script leaves alone, and the suites load it from
# there (see below).
#
# Deliberately not `set -e`: a failing suite must not skip the suites after it
# or the report generation below, or a broken test leaves no coverage output at
# all to diagnose it with. Each suite and report command instead records its
# failure into $status, and the script exits with that status only after both
# reports have been written. The build steps before the suites are different:
# if any of them fails there is nothing worth measuring, so they exit at once.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
shopt -s nullglob

mode=all
if [[ $# -eq 1 && $1 == --unit-only ]]; then
    mode=unit-only
elif [[ $# -ne 0 ]]; then
    echo "usage: $0 [--unit-only]" >&2
    exit 2
fi

# cargo llvm-cov is not part of the usual toolchain, and c8 is not in a
# checkout whose node_modules/ predates it. Check for both before anything is
# touched, the last run's reports included, and say where the setup is, rather
# than leave cargo to report an unknown command or argument, or the run to find
# c8 missing after every suite. cargo llvm-cov sees to LLVM's own tools itself;
# 0.7.0 is the first version whose show-env takes --sh, and adds the coverage
# flags with a rustc wrapper rather than RUSTFLAGS.
llvm_cov_version=$(cargo llvm-cov --version)
if [[ $llvm_cov_version != "cargo-llvm-cov "* ]] ||
    ! printf '%s\n' 0.7.0 "${llvm_cov_version#cargo-llvm-cov }" | sort -C -V; then
    echo "error: cargo llvm-cov 0.7.0 or later is needed${llvm_cov_version:+, not ${llvm_cov_version#cargo-llvm-cov }}: see \"Code coverage\" in CONTRIBUTING.md for how to install it" >&2
    exit 1
fi
if ! ./node_modules/.bin/c8 --version >/dev/null; then
    echo "error: c8 is missing from node_modules/: run npm install" >&2
    exit 1
fi

rm -rf coverage || exit 1
mkdir -p coverage/tmp coverage/js coverage/rust coverage/addon || exit 1

# The instrumented build gets a target directory of its own. Cargo does not see
# the coverage flags (they are added by a rustc wrapper, below), so with the
# artifacts of a plain build at hand it would count them as fresh for this one
# and leave the addon silently uninstrumented, and a later plain build would
# reuse instrumented ones, which then write .profraw files wherever the addon
# runs. Its build-dir, where cargo keeps the intermediate artifacts, goes there
# too: a cargo config can set it apart from the target directory, for every
# build.
export CARGO_TARGET_DIR="$PWD/target/llvm-cov-target"
export CARGO_BUILD_BUILD_DIR="$CARGO_TARGET_DIR"

# RUSTC_WRAPPER and friends make the build below compile this crate with
# -C instrument-coverage (build scripts too, but the report leaves those out),
# and LLVM_PROFILE_FILE makes every process that loads the addon write a
# .profraw file into the target directory when it exits. show-env leaves
# RUSTFLAGS alone, so the --cfg scylla_unstable in .cargo/config.toml still
# applies.
llvm_cov_env=$(cargo llvm-cov show-env --sh) || exit 1
eval "$llvm_cov_env"
profraw_dir=$(dirname "$LLVM_PROFILE_FILE")

# Removes the .profraw files of earlier runs, and this crate's artifacts so it
# is rebuilt from scratch.
cargo llvm-cov clean --workspace || exit 1
# The addon, with the tests feature as npm run build:test builds it, and the
# loader that napi generates with it (index.js and index.d.ts), all into
# coverage/addon/ rather than the tree.
./node_modules/.bin/napi build --platform --features tests --output-dir coverage/addon || exit 1
addon=(coverage/addon/*.node)
if ((${#addon[@]} != 1)); then
    echo "error: napi build left ${#addon[@]} addons in coverage/addon/, not one" >&2
    exit 1
fi
# lib/ and the tests load the addon through the loader in the tree, as
# ../index, which loads the file that NAPI_RS_NATIVE_LIBRARY_PATH names, if set,
# rather than the addon next to it. But the loader also lists the addon's
# exports by name, those of the tests feature included, and tsc compiles lib/
# against index.d.ts, so both must be the ones generated with this build: a
# checkout may have none, or ones from an older build, or from one without the
# tests feature. Where they differ, they go in place, as npm run build:test
# would put them. The addon in the tree, if any, is left alone.
for file in index.js index.d.ts; do
    if ! cmp -s -- "coverage/addon/$file" "$file"; then
        cp -- "coverage/addon/$file" "$file" || exit 1
    fi
done
./node_modules/.bin/tsc -p tsconfig.build.json --inlineSourceMap || exit 1

suites=(unit unit-gc unit-not-supported)
if [[ $mode == unit-only ]]; then
    echo "--unit-only: skipping the integration suites; the reports cover the unit suites only."
else
    suites+=(integration integration-gc)
fi

# Set only now, so that only the suites write V8 coverage, and not npm, the napi
# CLI and tsc in the build above as well.
export NODE_V8_COVERAGE="$PWD/coverage/tmp"
export NAPI_RS_NATIVE_LIBRARY_PATH="$PWD/${addon[0]}"

status=0
for suite in "${suites[@]}"; do
    # The .profraw files of the suite are the ones newer than this marker. On a
    # filesystem with coarse timestamps, one written within the same tick would
    # not be, so the clock is let past the marker first.
    touch coverage/suite-start
    until touch coverage/suite-tick && [[ coverage/suite-tick -nt coverage/suite-start ]]; do
        sleep 0.01
    done
    # --fail-zero: a suite that runs no tests at all (unit-gc and integration-gc
    # select theirs with --grep) fails instead of passing with nothing measured.
    # --forbid-only: so does one that a committed .only cuts down to the tests
    # it singles out.
    npm run "$suite" -- --fail-zero --forbid-only || status=1
    # A process that loaded the instrumented addon writes a .profraw file when
    # it exits. None at all means the suite measured nothing on the Rust side --
    # an uninstrumented addon was loaded, or every process that loaded it was
    # killed or aborted -- and its Rust coverage would be missing from the
    # report without anything else failing.
    if [[ -z "$(find "$profraw_dir" -maxdepth 1 -name '*.profraw' -newer coverage/suite-start -print -quit)" ]]; then
        echo "error: npm run $suite wrote no .profraw file: the instrumented addon did not run" >&2
        status=1
    fi
done
rm -f coverage/suite-start coverage/suite-tick

./node_modules/.bin/c8 report \
    --temp-directory coverage/tmp \
    --report-dir coverage/js \
    --all --include main.js --include 'lib/**' \
    --reporter lcov --reporter text-summary |
    tee coverage/js/summary.txt || status=1

# napi build always passes --target, so the objects are under
# $CARGO_TARGET_DIR/<host>/ rather than where cargo llvm-cov looks by default.
host=$(rustc -vV | sed -n 's/^host: //p')
cargo llvm-cov report --target "$host" --lcov --output-path coverage/rust/lcov.info || status=1
cargo llvm-cov report --target "$host" --html --output-dir coverage/rust || status=1
cargo llvm-cov report --target "$host" --summary-only | tee coverage/rust/summary.txt || status=1

exit "$status"
