==============================
ScyllaDB Node.js-RS Driver
==============================

A client-side driver for `ScyllaDB <https://www.scylladb.com/>`_ written in Node.js and Rust.
This driver is an overlay over the `ScyllaDB Rust Driver <https://github.com/scylladb/scylla-rust-driver>`_,
with the interface based on the `DataStax Node.js Driver <https://github.com/datastax/nodejs-driver>`_.
Although optimized for ScyllaDB, the driver is also compatible with `Apache Cassandra® <https://cassandra.apache.org/>`_.

.. caution::

   This driver is currently in the experimental state.
   We are working on features necessary for the driver to be considered production ready.

.. toctree::
   :maxdepth: 2
   :hidden:

   api/index

Getting Started
===============

Installation
------------

.. code-block:: bash

   npm install scylladb-driver-alpha

Currently only Linux x86_64 architecture is supported, with planned support for other architectures in the future.

Examples
--------

You can find example usages of the driver in the `examples directory <https://github.com/scylladb/nodejs-rs-driver/tree/main/examples>`_.

Features
========

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

Roadmap
-------

Features planned for the driver to become production ready:

- Configurable load balancing and retry policies
- Faster performance, compared to DataStax Node.js driver
- SSL support
- Error handling, based on the Rust driver
- Migration guide from the DataStax driver

For other planned features, see the `Milestones <https://github.com/scylladb/nodejs-rs-driver/milestones>`_.

Reference
=========

* :doc:`API Reference <api/index>`
* `CQL binary protocol specification version 4 <https://github.com/apache/cassandra/blob/trunk/doc/native_protocol_v4.spec>`_
