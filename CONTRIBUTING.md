# Contributing to ScyllaDB Node.js-RS driver

Thank you for your interest in contributing to our driver!

## Local installation and build process

### System dependencies

The Rust build requires OpenSSL development headers and `pkg-config`. Install them before building:

- **Ubuntu/Debian:** `sudo apt install libssl-dev pkg-config`
- **Fedora/RHEL:** `sudo dnf install openssl-devel pkgconf`
- **Arch:** `sudo pacman -S openssl pkgconf`

### Install dependencies

You can install required packages with the following command:

```bash
npm install
```

### Building

For build process use this command:

```bash
npm run build
```

If you want to build in debug mode use this command:

```bash
npm run build:debug
```

## Static checks

Currently, for the rust code we require new PRs to compile without warnings, pass cargo fmt and clippy.
For the JS code we require that [prettier](https://prettier.io/) and [eslint](https://eslint.org/) checks pass.
You can launch all Rust and JS static checks with the `npm run pre-push` command.

## Testing the driver

### Test dependencies

Before running any of the tests, ensure the driver is built correctly.

For the integration tests you need to do the following steps before running tests:

1. Install [scylla-ccm](https://github.com/scylladb/scylla-ccm) package
(`pip install --user https://github.com/scylladb/scylla-ccm/archive/master.zip`).
You may also use [ccm](https://github.com/riptano/ccm) but not all tests are guaranteed to pass while using it.
2. Have ``java-8`` installed and available in path ``/usr/lib/jvm/java-8``
(this is for running integration tests with cassandra - scylla-ccm uses this hardcoded path)

If you want to run integration tests only with scylla, you don't have to install java.

### Running the tests

You can run currently supported test with the following commands:

- Unit tests (``npm run unit``) (this includes unit tests of the JS side and tests of the napi layer)
- Integration tests (``npm run integration`` - with cassandra, `CCM_IS_SCYLLA=true npm run integration` with scylla)
- Code coverage of both (``npm run coverage``), which needs a few more tools: see [Code coverage](#code-coverage) below

There are also some categories of unsupported tests. See `package.json` for a list of all possible commands.

### Code coverage

`npm run coverage` measures the code coverage of both layers of the driver, the JS API (`main.js` and `lib/`) and the Rust N-API addon (`src/`),
while running the suites the unit and integration workflows run: `unit`, `unit-gc`, `unit-not-supported`, `integration` and `integration-gc`.
The integration suites need the test dependencies described above; set `CCM_IS_SCYLLA=true` to run them against ScyllaDB, as CI does.
Without CCM, `npm run coverage -- --unit-only` runs the three unit suites only.

On top of the regular build dependencies, the Rust side needs [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) and LLVM's tools:

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov --locked
```

The script (`scripts/coverage.sh`) builds the addon with LLVM's source-based coverage, in `target/llvm-cov-target/` so that it never mixes with a regular build,
and compiles the TypeScript in `lib/` with inline source maps, so that the report names the `.ts` sources.
It then runs the suites, and writes an lcov report and an HTML report for each layer:
`coverage/js/lcov.info` and `coverage/js/lcov-report/index.html`, `coverage/rust/lcov.info` and `coverage/rust/html/index.html`.
It keeps going after a suite fails, so that both reports are still written, and exits non-zero at the end.
It also fails a suite that runs no tests, that contains an exclusive (`.only`) test, or in which no process wrote an LLVM profile, which means the instrumented addon did not run.

The build that it replaces is put back when the script exits, whether it succeeds, fails or is stopped by Ctrl-C, SIGTERM or SIGHUP:
the addon (`index.*.node`), the napi loader in `index.js` and `index.d.ts`, and the `.js` and `.d.ts` files that tsc emits next to each `.ts` source in `lib/`.
A file that was not there before the run is removed.
A run killed outright, by SIGKILL or a crash, cannot do that: it leaves the instrumented build in place, and the one from before in `coverage/prior-build/`.
`npm run coverage -- --restore` puts that back without measuring anything, and so does the next run, before anything else.
Only one run at a time can use a checkout: while one holds `target/coverage.lock`, another exits at once with an error.
`scripts/test-coverage.sh` tests that control flow, with every tool the script runs replaced by a stub; CI runs it before the real run.

CI runs the same script, integration suites included, in `.github/workflows/coverage.yml`,
on x86_64 Linux with node 20 and against the ScyllaDB version in `scylla_version.env`, and keeps both reports as the `coverage-report` workflow artifact.
It also uploads both reports from every passing run to [Codecov](https://codecov.io/gh/scylladb/nodejs-rs-driver),
which comments the coverage delta on the pull request; the components in `codecov.yml` split it into the JS API and the Rust addon.
Its statuses are informational, so a drop never blocks a merge.
