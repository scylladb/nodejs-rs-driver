# Contributing to ScyllaDB Node.js-RS driver

Thank you for your interest in contributing to our driver!

## Local installation and build process

### Install dependencies

You can install required packages with the following command:

```bash
npm install
```

You also need to install [NAPI-RS cli](https://napi.rs/docs/introduction/getting-started#install-cli):

```bash
npm install -g @napi-rs/cli
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

There are also some categories of unsupported tests. See `package.json` for a list of all possible commands.
