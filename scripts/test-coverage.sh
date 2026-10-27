#!/usr/bin/env bash
# Tests the control flow of scripts/coverage.sh: which steps it runs, in which
# order and with which exit status, when a step fails or a suite measures
# nothing; and that the suites run on the instrumented addon in coverage/addon/
# while the addon in the tree is left alone. It runs a copy of the script with
# every tool it calls replaced by a stub -- cargo, npm and rustc on PATH, napi,
# tsc and c8 in node_modules/.bin/ -- so nothing is built and no test runs. CI
# runs this before the real coverage run.
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/coverage.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
repo=$work/repo
failures=0

all_steps="version show-env clean build tsc unit unit-gc unit-not-supported integration integration-gc c8 rustc report-lcov report-html report-summary"
unit_steps="version show-env clean build tsc unit unit-gc unit-not-supported c8 rustc report-lcov report-html report-summary"

# The addon and its loader as a build of the driver puts them in place, what
# tsc emits in the copy's lib/ below, and the sources next to it, which no run
# may touch.
addon=index.linux-x64-gnu.node
loader=(index.js index.d.ts)
lib_outputs=(lib/a.js lib/a.d.ts lib/sub/b.js lib/sub/b.d.ts)
sources=(lib/a.ts lib/sub/b.ts lib/types.d.ts lib/plain.js)

# Each stub checks its arguments, appends the name of its step to $work/steps
# and fails the step if STUB_FAIL names it. cargo llvm-cov --version reports the
# version in STUB_LLVM_COV_VERSION, 0.9.1 by default; c8 --version is no step.
# The build writes the addon ("instrumented") and its loader ("generated") into
# coverage/addon/, and tsc writes lib/'s outputs ("instrumented"). A suite
# fails unless it would run on that addon, through that loader, and writes a
# .profraw file where LLVM_PROFILE_FILE says, as the instrumented addon does,
# unless STUB_NO_PROFILE names it.
stubs() {
    cat >"$work/bin/common" <<'EOF'
step() {
    echo "$1" >>"$STUB_STEPS"
    if [[ " ${STUB_FAIL:-} " == *" $1 "* ]]; then
        exit 1
    fi
}
unexpected() {
    echo "stub: unexpected call: $*" >&2
    echo unexpected >>"$STUB_STEPS"
    exit 99
}
EOF
    echo "lib_outputs=(${lib_outputs[*]})" >>"$work/bin/common"
    cat >"$work/bin/cargo" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/common"
case "$*" in
"llvm-cov --version")
    step version
    echo "cargo-llvm-cov ${STUB_LLVM_COV_VERSION:-0.9.1}"
    ;;
"llvm-cov show-env --sh")
    step show-env
    echo "export LLVM_PROFILE_FILE='$CARGO_TARGET_DIR/nodejs-rs-driver-%p-%4m.profraw'"
    ;;
"llvm-cov clean --workspace")
    step clean
    mkdir -p "$CARGO_TARGET_DIR"
    ;;
"llvm-cov report --target x86_64-unknown-linux-gnu --lcov --output-path coverage/rust/lcov.info")
    step report-lcov
    : >coverage/rust/lcov.info
    ;;
"llvm-cov report --target x86_64-unknown-linux-gnu --html --output-dir coverage/rust") step report-html ;;
"llvm-cov report --target x86_64-unknown-linux-gnu --summary-only") step report-summary ;;
*) unexpected cargo "$@" ;;
esac
EOF
    cat >"$repo/node_modules/.bin/napi" <<'EOF'
#!/usr/bin/env bash
. "$STUB_BIN/common"
[[ $* == "build --platform --features tests --output-dir coverage/addon" ]] || unexpected napi "$@"
# Cargo's build-dir goes with the target directory.
[[ ${CARGO_BUILD_BUILD_DIR-} == "$CARGO_TARGET_DIR" ]] || unexpected napi "$@" "(build-dir ${CARGO_BUILD_BUILD_DIR-unset})"
step build
echo instrumented >coverage/addon/index.linux-x64-gnu.node
echo generated >coverage/addon/index.js
echo generated >coverage/addon/index.d.ts
EOF
    cat >"$repo/node_modules/.bin/tsc" <<'EOF'
#!/usr/bin/env bash
. "$STUB_BIN/common"
[[ $* == "-p tsconfig.build.json --inlineSourceMap" ]] || unexpected tsc "$@"
# lib/ compiles against the declarations of the addon built for this run.
[[ $(cat index.d.ts 2>/dev/null) == generated ]] || unexpected tsc "$@" "(index.d.ts not the generated one)"
step tsc
for file in "${lib_outputs[@]}"; do
    echo instrumented >"$file"
done
EOF
    cat >"$work/bin/npm" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/common"
case "$*" in
"run "*" -- --fail-zero --forbid-only")
    suite=$2
    case "$suite" in
    unit | unit-gc | unit-not-supported | integration | integration-gc) ;;
    *) unexpected npm "$@" ;;
    esac
    # The suite loads the addon through ../index, which must be the loader
    # generated with the instrumented addon, and which then loads the file
    # NAPI_RS_NATIVE_LIBRARY_PATH names.
    if [[ $(cat index.js 2>/dev/null) != generated ||
        ${NAPI_RS_NATIVE_LIBRARY_PATH-} != "$PWD/coverage/addon/index.linux-x64-gnu.node" ]]; then
        unexpected npm "$@" "(loader $(cat index.js 2>/dev/null || echo none), addon ${NAPI_RS_NATIVE_LIBRARY_PATH-unset})"
    fi
    if [[ " ${STUB_NO_PROFILE:-} " != *" $suite "* ]]; then
        profile=${LLVM_PROFILE_FILE//%p/$$}
        touch "${profile//%m/0}"
    fi
    step "$suite"
    ;;
*) unexpected npm "$@" ;;
esac
EOF
    cat >"$work/bin/rustc" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/common"
[[ $* == -vV ]] || unexpected rustc "$@"
step rustc
echo "host: x86_64-unknown-linux-gnu"
EOF
    cat >"$repo/node_modules/.bin/c8" <<'EOF'
#!/usr/bin/env bash
. "$STUB_BIN/common"
if [[ $* == --version ]]; then
    echo 11.0.0
    exit 0
fi
[[ $* == "report --temp-directory coverage/tmp --report-dir coverage/js --all --include main.js --include lib/** --reporter lcov --reporter text-summary" ]] ||
    unexpected c8 "$@"
step c8
: >coverage/js/lcov.info
EOF
    chmod +x "$work/bin/cargo" "$work/bin/npm" "$work/bin/rustc" \
        "$repo/node_modules/.bin/napi" "$repo/node_modules/.bin/tsc" "$repo/node_modules/.bin/c8"
}

# A fresh copy of the script, in a repository of its own. With "prior", it
# holds a build of the driver from before the run.
setup() {
    local file
    rm -rf "${repo:?}" "${work:?}/bin"
    mkdir -p "$repo/scripts" "$repo/node_modules/.bin" "$repo/lib/sub" "$work/bin"
    cp "$script" "$repo/scripts/coverage.sh"
    for file in "${sources[@]}"; do
        echo source >"$repo/$file"
    done
    stubs
    if [[ ${1:-} == prior ]]; then
        for file in "$addon" "${loader[@]}" "${lib_outputs[@]}"; do
            echo prior >"$repo/$file"
        done
    fi
}

# Runs the copy with the given arguments, and records its exit status in $status
# and the steps it ran in $steps.
run() {
    : >"$work/steps"
    status=0
    STUB_STEPS=$work/steps STUB_BIN=$work/bin PATH="$work/bin:$PATH" \
        bash "$repo/scripts/coverage.sh" "$@" >"$work/output" 2>&1 || status=$?
    steps=$(tr '\n' ' ' <"$work/steps")
    steps=${steps% }
}

pass() {
    echo "ok: $1"
}

fail() {
    echo "FAILED: $1"
    failures=$((failures + 1))
}

# expect DESCRIPTION STATUS STEPS: checks the last run's exit status and steps.
expect() {
    if [[ $status == "$2" && $steps == "$3" ]]; then
        pass "$1"
    else
        fail "$1"
        echo "  exit status: $status, expected $2"
        echo "  steps: $steps"
        echo "  expected:  $3"
        sed 's/^/  | /' "$work/output"
    fi
}

# expect_output DESCRIPTION TEXT: checks that the last run's output says TEXT.
expect_output() {
    if grep -qF -- "$2" "$work/output"; then
        pass "$1"
    else
        fail "$1"
        sed 's/^/  | /' "$work/output"
    fi
}

# expect_tree DESCRIPTION ADDON LOADER LIB: checks what the tree holds after the
# run: the addon, the loader and lib/'s outputs each hold the given text, or
# are not there (none), and the sources are as they were.
expect_tree() {
    local file expected="" found=""
    expected+="$addon:$2 "
    for file in "${loader[@]}"; do
        expected+="$file:$3 "
    done
    for file in "${lib_outputs[@]}"; do
        expected+="$file:$4 "
    done
    for file in "${sources[@]}"; do
        expected+="$file:source "
    done
    for file in "$addon" "${loader[@]}" "${lib_outputs[@]}" "${sources[@]}"; do
        found+="$file:$(cat "$repo/$file" 2>/dev/null || echo none) "
    done
    if [[ $found == "$expected" ]]; then
        pass "$1"
    else
        fail "$1"
        echo "  found:    $found"
        echo "  expected: $expected"
    fi
}

setup prior
run
expect "a clean run runs every step, in order, and succeeds" 0 "$all_steps"
expect_tree "... and leaves the addon in the tree alone, with the generated loader in place" \
    prior generated instrumented

setup
run
expect "a run in a checkout with no build succeeds" 0 "$all_steps"
expect_tree "... and puts the generated loader in place, but no addon" none generated instrumented

setup prior
for file in "${loader[@]}"; do
    echo generated >"$repo/$file"
    touch -d 2000-01-01 "$repo/$file"
done
run
expect "a run with the generated loader already in place succeeds" 0 "$all_steps"
if [[ -z $(find "$repo/index.js" "$repo/index.d.ts" -newermt 2000-01-02) ]]; then
    pass "... and leaves that loader as it was"
else
    fail "... and leaves that loader as it was"
fi

setup prior
run --unit-only
expect "--unit-only leaves the integration suites out" 0 "$unit_steps"

setup
for args in "--unit-only --integration" --restore --bogus; do
    # shellcheck disable=SC2086 # split into arguments on purpose
    run $args
    expect "arguments $args are rejected before anything runs" 2 ""
done

for suite in unit integration; do
    setup
    STUB_FAIL=$suite run
    expect "a failing $suite suite fails the run, after every other suite and report" 1 "$all_steps"
done

setup
STUB_NO_PROFILE=unit-gc run
expect "a suite that writes no LLVM profile fails the run, after every other step" 1 "$all_steps"
expect_output "... and says so" "npm run unit-gc wrote no .profraw file"

for report in c8 report-lcov report-html report-summary; do
    setup
    STUB_FAIL=$report run
    expect "a failing $report step fails the run, after every other report" 1 "$all_steps"
done

setup prior
STUB_FAIL=version run
expect "a missing cargo llvm-cov stops the run first" 1 "version"
expect_output "... says where to find out how to install it" '"Code coverage" in CONTRIBUTING.md'
expect_tree "... and leaves the tree alone" prior prior prior
setup prior
STUB_LLVM_COV_VERSION=0.6.24 run
expect "a cargo llvm-cov older than 0.7.0 stops the run first" 1 "version"
expect_output "... says which version it needs" "cargo llvm-cov 0.7.0 or later is needed, not 0.6.24"
for version in 0.7.0 0.10.0; do
    setup
    STUB_LLVM_COV_VERSION=$version run
    expect "cargo llvm-cov $version is recent enough" 0 "$all_steps"
done
setup prior
rm "$repo/node_modules/.bin/c8"
run
expect "a missing c8 stops the run first" 1 "version"
expect_output "... says how to install it" "run npm install"
expect_tree "... and leaves the tree alone" prior prior prior

setup prior
STUB_FAIL=build run
expect "a failing build stops the run" 1 "version show-env clean build"
expect_tree "... and leaves the tree alone" prior prior prior
setup prior
STUB_FAIL=tsc run
expect "a failing tsc stops the run" 1 "version show-env clean build tsc"

if ((failures)); then
    echo "$failures failed"
    exit 1
fi
echo "all passed"
