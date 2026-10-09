#!/usr/bin/env bash
# Tests the control flow of scripts/coverage.sh: which steps it runs, in which
# order and with which exit status, when a step fails or a suite measures
# nothing, that it puts back the build of the driver it replaces, and that it
# keeps a second run out while one is going. It runs a copy of the script with
# every tool it calls replaced by a stub -- cargo, npm and rustc on PATH, tsc and
# c8 in node_modules/.bin/ -- so nothing is built and no test runs. CI runs this
# before the real coverage run.
set -euo pipefail

script=$(cd "$(dirname "$0")" && pwd)/coverage.sh
real_cp=$(command -v cp)
real_mv=$(command -v mv)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
repo=$work/repo
failures=0

all_steps="version show-env clean build:test tsc unit unit-gc unit-not-supported integration integration-gc c8 rustc report-lcov report-html report-summary"
unit_steps="version show-env clean build:test tsc unit unit-gc unit-not-supported c8 rustc report-lcov report-html report-summary"

# The files a build of the driver puts in place, in the copy's lib/ below, and
# the sources next to them, which no run may touch.
addon_files=(index.js index.d.ts index.linux-x64-gnu.node)
lib_outputs=(lib/a.js lib/a.d.ts lib/sub/b.js lib/sub/b.d.ts)
sources=(lib/a.ts lib/sub/b.ts lib/types.d.ts lib/plain.js)

# Each stub checks its arguments, appends the name of its step to $work/steps
# and fails the step if STUB_FAIL names it. A failing build or tsc has written
# part of its output first. A suite also writes a .profraw file into the target
# directory, as the instrumented addon does, unless STUB_NO_PROFILE names it,
# and sends the signal in STUB_KILL to the script and itself if STUB_KILL_SUITE
# names it. With STUB_DAEMON set, the build leaves a process running and writes
# its pid there. cp and mv fail the first call whose source is the file
# STUB_FAIL_FILE names.
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
    echo "cargo-llvm-cov 0.9.1"
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
    cat >"$work/bin/npm" <<'EOF'
#!/usr/bin/env bash
. "$(dirname "$0")/common"
case "$*" in
"run build:test")
    echo instrumented >index.js
    step build:test
    for file in index.d.ts index.linux-x64-gnu.node; do
        echo instrumented >"$file"
    done
    # build:test ends with a plain tsc run of its own.
    for file in "${lib_outputs[@]}"; do
        echo plain >"$file"
    done
    if [[ -n ${STUB_DAEMON:-} ]]; then
        sleep 60 </dev/null >/dev/null 2>&1 &
        echo $! >"$STUB_DAEMON"
    fi
    ;;
"run "*" -- --fail-zero --forbid-only")
    suite=$2
    case "$suite" in
    unit | unit-gc | unit-not-supported | integration | integration-gc) ;;
    *) unexpected npm "$@" ;;
    esac
    if [[ " ${STUB_NO_PROFILE:-} " != *" $suite "* ]]; then
        # The script only counts a profile newer than the marker it touches
        # before the suite, so on a clock coarser than this stub is quick, wait
        # for it to tick.
        profile=$(dirname "$LLVM_PROFILE_FILE")/$suite.profraw
        touch "$profile"
        until [[ -n $(find "$profile" -newer coverage/suite-start) ]]; do
            sleep 0.01
            touch "$profile"
        done
    fi
    step "$suite"
    # Like a ^C or a kill of the process group: the script and the suite both
    # get the signal.
    if [[ $suite == "${STUB_KILL_SUITE:-}" ]]; then
        kill -s "$STUB_KILL" "$PPID" "$$"
    fi
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
    cat >"$repo/node_modules/.bin/tsc" <<'EOF'
#!/usr/bin/env bash
. "$STUB_BIN/common"
[[ $* == "-p tsconfig.build.json --inlineSourceMap" ]] || unexpected tsc "$@"
echo instrumented >"${lib_outputs[0]}"
step tsc
for file in "${lib_outputs[@]}"; do
    echo instrumented >"$file"
done
EOF
    cat >"$repo/node_modules/.bin/c8" <<'EOF'
#!/usr/bin/env bash
. "$STUB_BIN/common"
[[ $* == "report --temp-directory coverage/tmp --report-dir coverage/js --all --include main.js --include lib/** --reporter lcov --reporter text-summary" ]] ||
    unexpected c8 "$@"
step c8
: >coverage/js/lcov.info
EOF
    cat >"$work/bin/cp" <<'EOF'
#!/usr/bin/env bash
if [[ -n ${STUB_FAIL_FILE:-} && ${*: -2:1} == "$STUB_FAIL_FILE" && ! -e $STUB_BIN/file-failed ]]; then
    touch "$STUB_BIN/file-failed"
    echo "$(basename "$0"): stub failure" >&2
    exit 1
fi
if [[ $(basename "$0") == mv ]]; then
    exec "$STUB_REAL_MV" "$@"
fi
exec "$STUB_REAL_CP" "$@"
EOF
    "$real_cp" "$work/bin/cp" "$work/bin/mv"
    chmod +x "$work/bin/cargo" "$work/bin/npm" "$work/bin/rustc" "$work/bin/cp" "$work/bin/mv" \
        "$repo/node_modules/.bin/tsc" "$repo/node_modules/.bin/c8"
}

# A fresh copy of the script, in a repository of its own. With "prior", it
# holds a build of the driver from before the run; with "lib", only lib/'s part
# of one, as `npm run build:ts` alone leaves.
setup() {
    local file
    rm -rf "${repo:?}" "${work:?}/bin"
    mkdir -p "$repo/scripts" "$repo/node_modules/.bin" "$repo/lib/sub" "$work/bin"
    cp "$script" "$repo/scripts/coverage.sh"
    for file in "${sources[@]}"; do
        echo source >"$repo/$file"
    done
    stubs
    case ${1:-} in
    prior)
        for file in "${addon_files[@]}" "${lib_outputs[@]}"; do
            echo prior >"$repo/$file"
        done
        ;;
    lib)
        for file in "${lib_outputs[@]}"; do
            echo prior >"$repo/$file"
        done
        ;;
    esac
}

# A shell that starts with a signal ignored cannot trap it, and passes that on,
# as a CI runner may; GNU env puts them back to the default.
default_signals=()
if env --default-signal=INT true 2>/dev/null; then
    default_signals=(env "--default-signal=INT,TERM,HUP")
fi

# Runs the copy with the given arguments, and records its exit status in $status
# and the steps it ran in $steps.
run() {
    : >"$work/steps"
    status=0
    # The braces keep the shell's own notice of a run killed by a signal quiet.
    {
        STUB_STEPS=$work/steps STUB_BIN=$work/bin STUB_REAL_CP=$real_cp STUB_REAL_MV=$real_mv \
            PATH="$work/bin:$PATH" \
            ${default_signals[@]+"${default_signals[@]}"} \
            bash "$repo/scripts/coverage.sh" "$@" >"$work/output" 2>&1 || status=$?
    } 2>/dev/null
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

# expect_files DESCRIPTION STATE: checks what is left of the build of the driver
# after the run: every generated file holding "prior" (STATE prior), none of
# them (none), or only lib/'s (lib); and that the sources are as they were and
# no copy is left in coverage/prior-build/.
expect_files() {
    local file addon=$2 lib=$2 expected="" found=""
    if [[ $2 == lib ]]; then
        addon=none lib=prior
    fi
    for file in "${addon_files[@]}"; do
        expected+="$file:$addon "
    done
    for file in "${lib_outputs[@]}"; do
        expected+="$file:$lib "
    done
    for file in "${sources[@]}"; do
        expected+="$file:source "
    done
    for file in "${addon_files[@]}" "${lib_outputs[@]}" "${sources[@]}"; do
        found+="$file:$(cat "$repo/$file" 2>/dev/null || echo none) "
    done
    if [[ -e $repo/coverage/prior-build ]]; then
        found+="coverage/prior-build "
    fi
    if [[ $found == "$expected" ]]; then
        pass "$1"
    else
        fail "$1"
        echo "  found:    $found"
        echo "  expected: $expected"
    fi
}

# expect_killed_state DESCRIPTION: checks the state a run killed outright after
# the build leaves: the instrumented build in place, the one from before in
# coverage/prior-build/.
expect_killed_state() {
    local file wrong=""
    for file in "${addon_files[@]}" "${lib_outputs[@]}"; do
        [[ $(cat "$repo/$file") == instrumented ]] || wrong+="$file "
        [[ $(cat "$repo/coverage/prior-build/$file" 2>/dev/null) == prior ]] || wrong+="coverage/prior-build/$file "
    done
    if [[ -z $wrong ]]; then
        pass "$1"
    else
        fail "$1"
        echo "  not as expected: $wrong"
    fi
}

# hold_lock / release_lock: plays another run of the script in the copy.
hold_lock() {
    mkdir -p "$repo/target"
    exec 8>>"$repo/target/coverage.lock"
    flock -n 8
}

release_lock() {
    exec 8>&-
}

setup
run
expect "a clean run runs every step, in order, and succeeds" 0 "$all_steps"

setup
run --unit-only
expect "--unit-only leaves the integration suites out" 0 "$unit_steps"

setup
for args in "--unit-only --integration" "--restore --unit-only" --bogus; do
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
expect_files "... and leaves the build from before alone" prior

setup
STUB_FAIL=build:test run
expect "a failing build stops the run" 1 "version show-env clean build:test"
setup
STUB_FAIL=tsc run
expect "a failing tsc stops the run" 1 "version show-env clean build:test tsc"

setup prior
run
expect_files "the build from before a clean run is put back" prior
setup
run
expect_files "without a build before, the instrumented one is removed" none
setup lib
run
expect_files "with only lib/'s build before, that is put back and the addon removed" lib
setup prior
STUB_FAIL=build:test run
expect_files "the build from before is put back after a failing build" prior
setup prior
STUB_FAIL=tsc run
expect_files "the build from before is put back after a failing tsc" prior
setup prior
STUB_FAIL=integration run
expect_files "the build from before is put back after a failing suite" prior
for signal in INT:130 TERM:143 HUP:129; do
    setup prior
    STUB_KILL=${signal%:*} STUB_KILL_SUITE=unit-gc run
    expect "SIG${signal%:*} stops the run" "${signal#*:}" "version show-env clean build:test tsc unit unit-gc"
    expect_files "... and the build from before is put back" prior
done

setup prior
STUB_KILL=KILL STUB_KILL_SUITE=unit-gc run
expect "SIGKILL stops the run" 137 "version show-env clean build:test tsc unit unit-gc"
expect_killed_state "... and leaves the build from before in coverage/prior-build/"
run
expect "the run after that runs every step" 0 "$all_steps"
expect_output "... says it puts back the build from before the killed run" \
    "Putting back the build that an earlier run left in coverage/prior-build/."
expect_files "... and puts it back" prior

setup prior
STUB_KILL=KILL STUB_KILL_SUITE=unit run
run --restore
expect "--restore after a killed run runs no step" 0 ""
expect_files "... and puts back the build from before it" prior
run --restore
expect "--restore with nothing to put back does nothing" 0 ""
expect_output "... and says so" "Nothing to put back"
expect_files "... to the build" prior

for failure in index.js lib/sub/b.js coverage/prior-build.partial; do
    setup prior
    STUB_FAIL_FILE=$failure run
    expect "a failing copy of the build from before ($failure) stops the run" 1 "version"
    expect_files "... and leaves that build as it was" prior
done
for failure in coverage/prior-build/index.js coverage/prior-build/lib/sub/b.js coverage/prior-build; do
    setup prior
    STUB_FAIL_FILE=$failure run
    expect "a restore that fails partway ($failure) fails the run, after every step" 1 "$all_steps"
    run
    expect "the run after that runs every step" 0 "$all_steps"
    expect_files "... and finishes putting back the build from before" prior
done

setup prior
hold_lock
run
expect "a run while another holds the lock stops before anything runs" 1 ""
expect_output "... says so" "holds target/coverage.lock"
expect_files "... and leaves the build alone" prior
release_lock
setup prior
STUB_KILL=KILL STUB_KILL_SUITE=unit run
hold_lock
run --restore
expect "--restore while another run holds the lock does nothing" 1 ""
expect_killed_state "... to what a killed run left"
release_lock
run --restore
expect "--restore once the lock is free puts the build back" 0 ""
expect_files "... all of it" prior

setup prior
STUB_DAEMON=$work/daemon.pid run
expect "a run whose build leaves a process running succeeds" 0 "$all_steps"
daemon=$(cat "$work/daemon.pid")
run
if kill "$daemon" 2>/dev/null; then
    expect "... and that process does not keep the next run out" 0 "$all_steps"
else
    fail "... and that process is still running for the next run"
fi

if ((failures)); then
    echo "$failures failed"
    exit 1
fi
echo "all passed"
