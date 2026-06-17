==============================
ScyllaDB Node.js RS Driver
==============================

A client-side driver for `ScyllaDB <https://www.scylladb.com/>`_ written in Node.js and Rust.
This driver is an overlay over the `ScyllaDB Rust Driver <https://github.com/scylladb/scylla-rust-driver>`_,
with the interface based on the `Apache cassandra-driver <https://github.com/apache/cassandra-nodejs-driver>`_.
Although optimized for ScyllaDB, the driver is also compatible with `Apache Cassandra® <https://cassandra.apache.org/>`_.

This driver is considered production-ready.
Support for some optional driver features is planned for upcoming releases.

.. toctree::
   :maxdepth: 2
   :hidden:

   getting-started/getting-started
   statements/index
   paging/paging
   logging/logging
   policies/index
   connecting/authentication
   shutdown/shutdown
   migration-guide/migration-guide
   api/index

Contents
========

- :doc:`Getting Started <getting-started/getting-started>` - Installing the driver and executing your first statements
- :doc:`Statements <statements/index>` - Prepared, unprepared, and batch statements

  - :doc:`Executing CQL Statements - Best Practices <statements/prepared>`
  - :doc:`Unprepared Statements <statements/unprepared>`
  - :doc:`Batch Statements <statements/batch>`

- :doc:`Fetching Large Result Sets <paging/paging>` - Paging through large result sets
- :doc:`Policies <policies/index>` - Load balancing and retry policies
- :doc:`Authentication <connecting/authentication>` - Connecting with credentials or SSL
- :doc:`Shutdown <shutdown/shutdown>` - How the driver manages connection lifecycle
- :doc:`Migration Guide <migration-guide/migration-guide>` - Migrating from the Apache ``cassandra-driver``
- :doc:`API Reference <api/index>` - Full API documentation

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
- SSL support
- Configurable load balancing, retry policies
- Simple address translation policy
- Error handling, based on the Rust driver
- Driver logging
- Faster performance, compared to DataStax Node.js driver(*)

(*) In most of the internally conducted benchmarks

Roadmap
-------

For planned features, see the `Milestones <https://github.com/scylladb/nodejs-rs-driver/milestones>`_.

Other resources
===============

* `CQL binary protocol specification version 4 <https://github.com/apache/cassandra/blob/trunk/doc/native_protocol_v4.spec>`_
* `Examples <https://github.com/scylladb/nodejs-rs-driver/tree/main/examples>`_
