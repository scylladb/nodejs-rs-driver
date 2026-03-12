# Maintenance

The following document includes information on how to release scylladb-nodejs-rs and other information / procedures useful for maintainers.

## NPM package

### Changing project structure

#### Adding new files

When you add a new top level file or directory (i.e., one put directly in the repo's root), you need to consider
if this file / directory is necessary for the NPM package. If you determine that this file should not be present
in the released npm package (things like rust source code, linter configuration files, ...) you have to add this
file to `.npmignore`. All files listed there will **NOT** be added to the npm package on release.

#### Removing files

When you remove a top level file or directory, remember to check (and remove if present)
if the deleted file / directory was present in `.npmignore` file.

## CI

We split the CI into two parts:

- regular CI, that we run on each PR
- extended CI, that we run on each release

We also have additional CI, that can be run occasionally:

- benchmarks (can be triggered manually)
- documentation release (triggered on pushes to main)

### Regular CI

The regular CI consists of the following workflows:

- Checking code quality (linters for JS and Rust)
- TypeScript tests
- Unit tests
- JSDoc linter
- Partial examples (see below)
- Partial integration tests

### Extended CI

The extended CI consists of the following workflow:

- Full examples (see bellow)
- Full integration tests

### Matrix

We run examples on multiple node versions and architectures.

- ✅ - means we run it both on regular and extended CI
- 🟠 - means we run it on extended CI only
- ❌ - means we do not run this configuration

The motivation for such split is to reduce the execution time for CI that is run on each commit / PR,
while also ensuring the driver works correctly in most common configurations, when creating a new release.

#### Examples

Linux examples are run with ScyllaDB in a docker container.

|               | Linux x64  | Linux arm  | MacOS Intel* | MacOS Arm*   |
|-------------- |----------- |----------- |------------- |------------- |
| Node 20       | ✅         | 🟠         | ❌ (planned) | ❌ (planned) |
| Node 22       | 🟠         | 🟠         | ❌ (planned) | ❌ (planned) |
| Node 24       | 🟠         | 🟠         | ❌ (planned) | ❌ (planned) |
| Node current  | ✅         | ✅         | ❌ (planned) | ❌ (planned) |

*) Disabled due to problems with docker. There are plans to run them with Cassandra,
launched through CCM. Split between regular and extended CI is not yet decided.

#### Integration tests

|               | Linux x64  | Linux arm**| MacOS Intel  | MacOS Arm  |
|-------------- |----------- |----------- |------------- |----------- |
| Node 20       | ✅         | ❌         | ❌ (planned) | ❌         |
| Node 22       | 🟠         | ❌         | ❌ (planned) | ❌         |
| Node 24       | 🟠         | ❌         | ❌ (planned) | ❌         |
| Node current  | 🟠         | ❌         | ❌ (planned) | ❌         |

**) Disabled due to problems with ccm

## Releasing process

1. Bump the package version. Remember to update the version in `package-lock.json` in
main directory, examples and benchmarks
(see [example commit](https://github.com/scylladb/nodejs-rs-driver/pull/363/changes/41250609737052975129c7514439869324478008) on how to do that).
2. Create a new tag
3. Ensure the extended CI passes.
4. Create release notes on GitHub. The version tag must match version from `package.json` with `v` prefix (for example: `v0.2.0`).
Once you publish release notes, CI action will trigger automatically. This action will build and publish the npm package.
5. Once the CI action finishes, check if it succeeded. If it failed, you will have to fix the underlying issue, and re-run the CI action.
6. Verify that the new release is visible at [npmjs site](https://www.npmjs.com/package/scylladb-driver-alpha).
7. Test the package, by installing it directly from npm. Go to `examples` directory, in `package.json` update the line:
`"scylladb-driver-alpha": "file:./../"`
to:
`"scylladb-driver-alpha": "<just-released-version>"`,
then run the following command:
`npm i && node ./runner.js`
<!-- The last step can potentially be set up as a CI action step. -->
