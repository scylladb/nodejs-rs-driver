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
# integration suites, for a machine without CCM; CI never passes it. --restore
# measures nothing: it only puts back the build that a killed run left aside
# (see below).
#
# The JS layer is measured with V8's own coverage (NODE_V8_COVERAGE, reported by
# c8), so the sources run unmodified; the TypeScript in lib/ is recompiled with
# inline source maps, so the report names the .ts sources rather than the
# untracked .js that tsc emits next to them. The Rust layer is built with LLVM's
# source-based coverage (cargo llvm-cov show-env, then the usual napi build) and
# reported by cargo llvm-cov.
#
# Deliberately not `set -e`: a failing suite must not skip the suites after it
# or the report generation below, or a broken test leaves no coverage output at
# all to diagnose it with. Each suite and report command instead records its
# failure into $status, and the script exits with that status only after both
# reports have been written. The build steps before the suites are different:
# if any of them fails there is nothing worth measuring, so they exit at once.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

mode=all
if [[ $# -eq 1 && ($1 == --unit-only || $1 == --restore) ]]; then
    mode=${1#--}
elif [[ $# -ne 0 ]]; then
    echo "usage: $0 [--unit-only | --restore]" >&2
    exit 2
fi

# The napi-generated loader (index.js) loads whatever file this names instead
# of the addon built below.
unset NAPI_RS_NATIVE_LIBRARY_PATH

# One run at a time in a checkout: two would build over each other's addon, and
# one could put back or delete the build the other set aside. The lock is on a
# file under target/, which nothing below deletes, and only this shell holds it:
# the rest of the script runs with its descriptor closed (bash keeps a
# close-on-exec copy of it meanwhile), so no process the script starts -- a
# server that a build or a test leaves running, say -- keeps it past the
# script. The kernel drops it when the shell exits, even if it is killed
# outright.
mkdir -p target && exec 9>>target/coverage.lock || exit 1
if ! flock -n 9; then
    echo "error: another run of $0 holds target/coverage.lock" >&2
    exit 1
fi
{
    # npm run build:test and tsc below put an instrumented build of the driver
    # in place of whatever build is there: the addon (index.*.node), the napi
    # loader generated for it (index.js and index.d.ts), and the JavaScript and
    # declarations that tsc emits next to each TypeScript source in lib/. That
    # build is fit for this run only: any process that loads it later writes a
    # .profraw file into its working directory, and runs a debug addon built
    # with the tests feature. So the files it replaces are copied into
    # coverage/prior-build/ first and put back when the script exits, whether it
    # succeeds, fails or is stopped by SIGINT, SIGTERM or SIGHUP; a generated
    # file that was not there before is removed. A run killed outright, by
    # SIGKILL or a crash, cannot do that and leaves the copy where it is:
    # --restore puts it back, and so does the next run, before anything else.
    # Either step can be cut short and simply run again: the copy only counts
    # once it is complete, and it is only dropped once it is back. Neither step
    # puts the copy back over a build made since: once the instrumented build is
    # complete, its checksums are recorded next to the copy, and a build in
    # place that no longer matches them is left alone, with an error.
    shopt -s nullglob
    prior_build=coverage/prior-build
    instrumented_build=$prior_build.sha256

    # Lists the files a build puts in place, one per line, whether each of them
    # is there or not: the napi loader, every index.*.node there is, and what
    # tsc emits for each TypeScript source in lib/.
    generated_files() {
        local source
        printf '%s\n' index.js index.d.ts index.*.node
        while IFS= read -r source; do
            printf '%s\n' "${source%.ts}.js" "${source%.ts}.d.ts"
        done < <(find lib -name '*.ts' ! -name '*.d.ts')
    }

    # Prints the checksum of each file a build put in place, in a fixed order.
    build_checksums() {
        local file
        while IFS= read -r file; do
            if [[ -e $file ]]; then
                sha256sum -- "$file" || return 1
            fi
        done < <(generated_files | LC_ALL=C sort)
    }

    # Each file is copied next to its place and renamed over it, so that a
    # process that still has the addon mapped keeps the file it loaded rather
    # than see it overwritten.
    restore_prior_build() {
        [[ -d $prior_build ]] || return 0
        local file
        if [[ -e $instrumented_build ]] && ! build_checksums | cmp -s - "$instrumented_build"; then
            echo "error: the build in place is not the one a run of $0 left there, so the build in $prior_build/ is not put back over it; delete $prior_build/ to keep the build in place" >&2
            return 1
        fi
        rm -f -- "$instrumented_build" || return 1
        while IFS= read -r file; do
            if [[ ! -e $prior_build/$file ]]; then
                rm -f -- "$file" || return 1
            fi
        done < <(generated_files)
        while IFS= read -r file; do
            mkdir -p -- "$(dirname -- "$file")" &&
                cp -p -- "$prior_build/$file" "$file.coverage-tmp" &&
                mv -f -- "$file.coverage-tmp" "$file" || return 1
        done < <(cd "$prior_build" && find . -type f | sed 's|^\./||')
        mv -- "$prior_build" "$prior_build.restored" && rm -rf -- "$prior_build.restored"
    }

    if [[ -d $prior_build ]]; then
        echo "Putting back the build that an earlier run left in $prior_build/."
        restore_prior_build || exit 1
    elif [[ $mode == restore ]]; then
        echo "Nothing to put back: there is no $prior_build/."
    fi
    if [[ $mode == restore ]]; then
        exit 0
    fi

    # cargo llvm-cov is not part of the usual toolchain. Check for it before
    # anything is touched, the last run's reports included, and say where the
    # setup is, rather than leave cargo to report an unknown command. It sees
    # to LLVM's own tools itself.
    if ! cargo llvm-cov --version >/dev/null; then
        echo "error: cargo llvm-cov is missing: see \"Code coverage\" in CONTRIBUTING.md for how to install it" >&2
        exit 1
    fi

    rm -rf coverage || exit 1
    mkdir -p coverage/tmp coverage/js coverage/rust "$prior_build.partial" || exit 1
    trap 'restore_prior_build || exit 1' EXIT

    # The build and the suites run in the background, each in a process group
    # of its own, while this shell waits for them. A signal that stops the run
    # may reach this shell alone -- a kill of the npm process that runs it,
    # which passes it on to its child only, say -- and the exit trap would then
    # put the build back while a suite still runs on it, or a build still writes
    # it, and drop the lock with them still running. So INT, TERM and HUP first
    # stop the whole group, with TERM (npm passes HUP on to no one), and wait
    # for it; further ones are ignored meanwhile, as npm passes a ^C on to this
    # shell on top of the one from the terminal. Only then does the shell end
    # with that signal, which runs the exit trap.
    step_pid=
    run_step() {
        # The script runs without job control, so the command is not a process
        # group leader, and setsid makes it the leader of a new group, $!.
        setsid "$@" &
        step_pid=$!
        wait "$step_pid"
        local step_status=$?
        step_pid=
        return "$step_status"
    }
    # shellcheck disable=SC2329 # invoked by the traps below
    stop() {
        trap '' INT TERM HUP
        if [[ -n $step_pid ]]; then
            kill -TERM -- "-$step_pid" 2>/dev/null
            wait "$step_pid"
        fi
        trap - "$1"
        kill -s "$1" "$$"
    }
    trap 'stop INT' INT
    trap 'stop TERM' TERM
    trap 'stop HUP' HUP

    while IFS= read -r file; do
        if [[ -e $file ]]; then
            cp -p --parents -- "$file" "$prior_build.partial/" || exit 1
        fi
    done < <(generated_files)
    mv -- "$prior_build.partial" "$prior_build" || exit 1

    # The instrumented build gets a target directory of its own. Cargo does not
    # see the coverage flags (they are added by a rustc wrapper, below), so in a
    # shared target/ it would count a plain build's artifacts as fresh for this
    # one and leave the addon silently uninstrumented, and a later plain build
    # would reuse instrumented build scripts, which then write .profraw files
    # into the tree.
    export CARGO_TARGET_DIR="$PWD/target/llvm-cov-target"

    # RUSTC_WRAPPER and friends make the build below compile this crate with
    # -C instrument-coverage (build scripts too, but the report leaves those
    # out), and LLVM_PROFILE_FILE makes every process that loads the addon write
    # a .profraw file into the target directory when it exits. show-env leaves
    # RUSTFLAGS alone, so the --cfg scylla_unstable in .cargo/config.toml still
    # applies.
    llvm_cov_env=$(cargo llvm-cov show-env --sh) || exit 1
    eval "$llvm_cov_env"
    profraw_dir=$(dirname "$LLVM_PROFILE_FILE")

    # Removes the .profraw files of earlier runs, and this crate's artifacts so
    # it is rebuilt from scratch.
    cargo llvm-cov clean --workspace || exit 1
    run_step npm run build:test || exit 1
    run_step ./node_modules/.bin/tsc -p tsconfig.build.json --inlineSourceMap || exit 1
    build_checksums >"$instrumented_build.partial" &&
        mv -- "$instrumented_build.partial" "$instrumented_build" || exit 1

    suites=(unit unit-gc unit-not-supported)
    if [[ $mode == unit-only ]]; then
        echo "--unit-only: skipping the integration suites; the reports cover the unit suites only."
    else
        suites+=(integration integration-gc)
    fi

    # Set only now, so that only the suites write V8 coverage, and not npm, the
    # napi CLI and tsc in the build above as well.
    export NODE_V8_COVERAGE="$PWD/coverage/tmp"

    status=0
    for suite in "${suites[@]}"; do
        touch coverage/suite-start
        # --fail-zero: a suite that runs no tests at all (unit-gc and
        # integration-gc select theirs with --grep) fails instead of passing
        # with nothing measured. --forbid-only: so does one that a committed
        # .only cuts down to the tests it singles out.
        run_step npm run "$suite" -- --fail-zero --forbid-only || status=1
        # A process that loaded the instrumented addon writes a .profraw file
        # when it exits. None at all means the suite measured nothing on the
        # Rust side -- an uninstrumented addon was loaded, or every process that
        # loaded it was killed or aborted -- and its Rust coverage would be
        # missing from the report without anything else failing.
        if [[ -z "$(find "$profraw_dir" -maxdepth 1 -name '*.profraw' -newer coverage/suite-start -print -quit)" ]]; then
            echo "error: npm run $suite wrote no .profraw file: the instrumented addon did not run" >&2
            status=1
        fi
    done
    rm -f coverage/suite-start

    ./node_modules/.bin/c8 report \
        --temp-directory coverage/tmp \
        --report-dir coverage/js \
        --all --include main.js --include 'lib/**' \
        --reporter lcov --reporter text-summary |
        tee coverage/js/summary.txt || status=1

    # napi build always passes --target, so the objects are under
    # $CARGO_TARGET_DIR/<host>/ rather than where cargo llvm-cov looks by
    # default.
    host=$(rustc -vV | sed -n 's/^host: //p')
    cargo llvm-cov report --target "$host" --lcov --output-path coverage/rust/lcov.info || status=1
    cargo llvm-cov report --target "$host" --html --output-dir coverage/rust || status=1
    cargo llvm-cov report --target "$host" --summary-only | tee coverage/rust/summary.txt || status=1

    exit "$status"
} 9>&-
