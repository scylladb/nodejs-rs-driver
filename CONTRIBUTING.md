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
It leaves out the Rust unit tests (`cargo test --lib`): their `#[cfg(test)]` modules sit inline in `src/`, so they would count their own lines as covered.
The integration suites need the test dependencies described above; set `CCM_IS_SCYLLA=true` to run them against ScyllaDB, as CI does.
Without CCM, `npm run coverage -- --unit-only` runs the three unit suites only.

On top of the regular build dependencies, the Rust side needs [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov) 0.7.0 or later and LLVM's tools
(the same `cargo install` updates an older cargo-llvm-cov):

```bash
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov --locked
```

The script (`scripts/coverage.sh`) builds the addon with LLVM's source-based coverage, in `target/llvm-cov-target/` so that it never mixes with a regular build,
and puts it in `coverage/addon/`, so that the addon in the tree, if any, is left alone: the suites load the instrumented one through `NAPI_RS_NATIVE_LIBRARY_PATH`.
They load it through the napi loader in the tree, though, which lists the addon's exports, so `index.js` and `index.d.ts` must be the ones generated with that build,
as `npm run build:test` would write them: the script puts them in place where they differ.
It also compiles the TypeScript in `lib/` in place, with inline source maps, so that the report names the `.ts` sources.
It then runs the suites, and writes an lcov report and an HTML report for each layer:
`coverage/js/lcov.info` and `coverage/js/lcov-report/index.html`, `coverage/rust/lcov.info` and `coverage/rust/html/index.html`.
It keeps going after a suite fails, so that both reports are still written, and exits non-zero at the end.
It also fails a suite that runs no tests, that contains an exclusive (`.only`) test, or in which no process wrote an LLVM profile, which means the instrumented addon did not run.
`scripts/test-coverage.sh` tests that control flow, with every tool the script runs replaced by a stub; CI runs it before the real run.

CI runs the same script, integration suites included, in `.github/workflows/coverage.yml`,
on x86_64 Linux with node 20 and against the ScyllaDB version in `scylla_version.env`, and keeps both reports as the `coverage-report` workflow artifact.
It also uploads both reports from every passing run to [Codecov](https://codecov.io/gh/scylladb/nodejs-rs-driver),
which comments the coverage delta on the pull request; the components in `codecov.yml` split it into the JS API and the Rust addon.
Its statuses are informational, so a drop never blocks a merge.
