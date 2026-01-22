# ScyllaDB Node.js-RS Driver

![test workflow](https://github.com/scylladb-zpp-2024-javascript-driver/scylladb-javascript-driver/actions/workflows/integration-tests.yml/badge.svg?branch=main)
![quality workflow](https://github.com/scylladb-zpp-2024-javascript-driver/scylladb-javascript-driver/actions/workflows/check-docs.yml/badge.svg?branch=main)

This is a client-side driver for [ScyllaDB](https://www.scylladb.com/) written in Node.js and Rust.
This driver is an overlay over the [ScyllaDB Rust Driver](https://github.com/scylladb/scylla-rust-driver),
with the interface based on the [DataStax Node.js Driver](https://github.com/datastax/nodejs-driver).
Although optimized for ScyllaDB, the driver is also compatible with [Apache Cassandra®](https://cassandra.apache.org/).

This driver is currently in the experimental state. We are working on features necessary for the driver to be considered production ready.

## Getting started

### Installation

``npm install scylladb-driver-alpha``

Currently only linux x86_64 architecture is supported with planned support for other architectures in the future.

### Documentation

The API ([documentation](https://scylladb.github.io/nodejs-rs-driver/docs/)) of the driver is based on the DataStax driver.
Some of the endpoints are already implemented, others are planned, and some parts of the API (including features that were deprecated and are specific to DataStax databases) are removed.
The status of each API endpoint is listed in [this document](https://docs.google.com/spreadsheets/d/e/2PACX-1vQyg-WhZaMVdBKttbDq7Iuec4KjoMJnU7XEGyiRBlgNubid8T7WqtAH1VDy32meQq5-04P72jLqhF3O/pubhtml#gid=2021765806) and unimplemented features are tracked in the repository [issues](https://github.com/scylladb/nodejs-rs-driver/issues).

<!-- Currently there is very little content in the book, so I don't think we should list it in the readme -->
<!-- Book is available [here](https://scylladb.github.io/nodejs-rs-driver/book) -->

## Examples

You can find example usages of the driver in the [examples directory](https://github.com/scylladb/nodejs-rs-driver/tree/main/examples).

## Features and roadmap

The driver supports the following:

- Simple, Prepared, and Batch statements
- Asynchronous IO, parallel execution, request pipelining
- Token-aware routing
- Shard-aware and Tablet-aware routing (specific to ScyllaDB)
- CQL binary protocol version 4
- Works with any cluster size
- Both promise and callback-based API
- Row streaming and pipes
- Built-in TypeScript support
- Password authentication
- Configurable load balancing policies
- Error handling, based on the Rust driver

Features that are planned for the driver to become production ready:

- Configurable retry policies
- Faster performance, compared to DataStax Node.js driver
- SSL support
- Migration guide from the DataStax driver

For other planned features see our [Milestones](https://github.com/scylladb/nodejs-rs-driver/milestones)

## Reference Documentation

- [CQL binary protocol](https://github.com/apache/cassandra/blob/trunk/doc/native_protocol_v4.spec) specification version 4
