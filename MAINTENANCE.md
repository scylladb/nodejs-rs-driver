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

## Releasing process

1. Bump the package version. Remember to update the version in `package-lock.json` in
main directory, examples and benchmarks
(see [example commit](https://github.com/scylladb/nodejs-rs-driver/pull/363/changes/41250609737052975129c7514439869324478008) on how to do that).
2. Create a release notes on GitHub. The version tag must match version from `package.json` with `v` prefix (for example: `v0.2.0`).
Once you publish release notes, CI action will trigger automatically. This action will build and publish the npm package.
3. Once the CI action finishes, check if it succeeded. If it failed, you will have to fix the underlying issue, and re-run the CI action.
4. Verify that the new release is visible at [npmjs site](https://www.npmjs.com/package/scylladb-driver-alpha).
5. Test the package, by installing it directly from npm. Go to `examples` directory, in `package.json` update the line:
`"scylladb-driver-alpha": "file:./../"`
to:
`"scylladb-driver-alpha": "<just-released-version>"`,
then run the following command:
`npm i && node ./runner.js`
<!-- The last step can potentially be set up as a CI action step. -->
