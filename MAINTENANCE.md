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

1. Update the driver dependencies. When updating / upgrading node dependencies,
you can either run `npm update` in the main directory, or manually update `package.json` or `package-lock.json` and run `npm i`.
Remember to run `npm i` in the `examples/` and `benchmark/` directories once you update the packages. See [Updating packages](#updating-packages) for more details.
2. Bump the package version. Remember to update the version in `package-lock.json` in
the main directory, `examples/`, and `benchmark/`. You can do this by running `npm i` in all 3 directories
(see [example commit](https://github.com/scylladb/nodejs-rs-driver/pull/363/changes/41250609737052975129c7514439869324478008) on how to do that).
3. Create a new tag.
4. Ensure the extended CI passes.
5. Create release notes on GitHub. The version tag must match version from `package.json` with `v` prefix (for example: `v0.2.0`).
Once you publish release notes, CI action will trigger automatically. This action will build and publish the npm package.
6. Once the CI action finishes, check if it succeeded. If it failed, you will have to fix the underlying issue, and re-run the CI action.
7. Verify that the new release is visible at [npmjs site](https://www.npmjs.com/package/@scylladb/driver).
8. Test the package, by installing it directly from npm. Go to `examples` directory, in `package.json` update the line:
`"@scylladb/driver": "file:./../"`
to:
`"@scylladb/driver": "<just-released-version>"`,
then run the following command:
`npm i && node ./runner.js`
<!-- The last step can potentially be set up as a CI action step. -->

### Updating packages

As we only have a single dependency (`long` package) used for released version of the package, the main goal of this is to update dev dependencies.
This is done to:

1. Resolve dependabot alerts. Doing it for every alert individually would be too tiresome,
but we still want to resolve those alerts.
2. Have access to new features. (But the point 1. is way more important).

When bumping version with `npm update` packages will be updated according to `package.json` semantics.
Updating this way will only update the lock file.
If this is not enough, you can manually update `package.json` or `package-lock.json`.

### Updating workflows

Note: There is no need to update workflows every release - this is used only for development purposes.
This part should only be done if the current setup is insufficient
(ex. there is a discovered vulnerability in current version, or there is a new feature).

Currently GitHub workflows are fixed to specific commits. This is done to reduce the supply chain attack surface in this repository.
When updating those workflows, to find the correct commit SHA for a new version, go to the action's repository on GitHub,
navigate to the desired release tag, and copy the full commit SHA from the tag's commit page.
Remember to ensure the commit you are pinning to is not
an [impostor commit](https://www.chainguard.dev/unchained/what-the-fork-imposter-commits-in-github-actions-and-ci-cd) - open the commit on GitHub page
and ensure there is no `This commit does not belong to any branch on this repository` message at the top of the page.
When updating the workflow you need to update both the `uses:` directive in workflow files and
`Actions -> General -> Allow or block specified actions and reusable workflows` option in repository options.

## TypeScript migration

While most of the codebase is currently written in JS, we have a goal of incremental transition to TypeScript (see #350).
When converting existing code from JS to TS you can do it in 2 parts:

- Ensuring type safety within JS code,
- Converting JS to TS.

The repository is set up in a way that supports files at all 3 conversion steps (including fully unconverted files).

### Ensuring type safety

All files that do not have `// @ts-nocheck` at the top of the file will be checked by TS compiler,
to ensure type safety. The compiler will use information from js docs for determining type information.

### Converting JS to TS

Once the `.js` file passes TypeScript checks it should be trivial to convert the file to TypeScript.
As this may require major trivial refactors, it's best to do this step with the use of LLMs.
You should still ensure no changes other than conversion were made and all tests pass.

TS files compilation results are placed in the same directory as the source file, which means that
you must manually add both `*.d.ts` and `*.js` to gitignore (do it in the same directory as the file, not in the global gitignore).
This approach guarantees imports work correctly both when running the code and using it in editor (type recognition).

Converted `.ts` files are compiled in-place by `tsc`, emitting `.js` and `.d.ts` next to the source.
This means `require("./foo")` continues to work for all consumers without any path changes.

### CI considerations

Any CI job that runs JavaScript from `lib/` needs the compiled output.
Workflows that call `npm run build` get this automatically, since `build` includes `build:ts`.
Jobs that skip the full build (e.g. the release test and publish steps) run `npm run build:ts` explicitly.
