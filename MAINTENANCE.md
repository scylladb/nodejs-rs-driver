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

ARM and x64 run the same integration test suites. ARM uses Node 20 to verify architecture-specific
behavior, while the extended x64 matrix verifies compatibility with every supported Node version.

|               | Linux x64  | Linux arm  | MacOS Intel  | MacOS Arm  |
|-------------- |----------- |----------- |------------- |----------- |
| Node 20       | ✅         | ✅         | ❌ (planned) | ❌         |
| Node 22       | 🟠         | ❌         | ❌ (planned) | ❌         |
| Node 24       | 🟠         | ❌         | ❌ (planned) | ❌         |
| Node current  | 🟠         | ❌         | ❌ (planned) | ❌         |

## Releasing process

All three npm packages must configure `.github/workflows/release.yml` as an npm trusted publisher with direct
publishing allowed. The release job authenticates with GitHub OIDC and intentionally does not use a long-lived
npm write token.

1. Open a release PR from an up-to-date `main` branch. Update dependencies as needed and set the same
   `X.Y.Z` version in `package.json`, the root npm lockfile, `Cargo.toml`, `Cargo.lock`, and the linked driver
   entry in `examples/package-lock.json`. Set `docs/version` to the matching `vX.Y.Z` tag.
2. Wait for the release PR checks. A version change automatically runs Extended CI and a production
   multiversion docs build against a temporary local tag. The docs check verifies the `main`, `stable`, and
   versioned outputs without creating remote release state.
3. Merge the release PR. Until the release is published, normal docs deployment continues to build
   `/stable` from the latest published GitHub Release rather than the not-yet-tagged target version.
4. From the `main` branch in the Actions UI, run **Release package** with `publish` disabled. This performs
   every build, test, docs, package-assembly, and npm dry-run gate without changing remote state.
5. Run **Release package** again from `main` with `publish` enabled. The workflow captures one `main` commit,
   re-runs all pre-tag gates against that exact commit, and checks for open `release-blocker` issues.
6. After every gate succeeds, the workflow rechecks release blockers and tag availability, creates the
   lightweight `vX.Y.Z` tag on the tested commit, publishes and verifies all npm packages, creates the GitHub
   Release, and promotes the same tag to `/stable` documentation.
7. Confirm the workflow completed, the tag and GitHub Release point to the captured commit, all three packages
   are visible on npm, and `/stable` selects the new version.

Do not create or move the release tag manually. A failure before the tag is created has no public release
state; fix it in another PR and dispatch the workflow again from the new `main` commit.

If npm publication fails after the tag is created, keep the tag fixed and rerun the failed workflow jobs from
the same workflow run. The publish job checks each package version and skips packages that already reached npm,
so it can finish a partial multi-package publication before verification and GitHub Release creation. Never
reuse that version for different contents. If the workflow run or its artifacts have expired, inspect the
published versions of `@scylladb/driver-linux-x64-gnu`, `@scylladb/driver-linux-arm64-gnu`, and
`@scylladb/driver`, then reconstruct the packages from the tagged commit and publish only the missing packages
from a trusted release environment.

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
- Ensure empty `.npmignore` is present in the directory you just introduced the typescript file in.

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
