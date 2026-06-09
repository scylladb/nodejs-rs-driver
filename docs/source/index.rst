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

   getting-started/getting-started.md
   statements/index
   paging/paging.md
   policies/load-balancing.md
   policies/retry-policy.md
   data-types/data-types.md
   auth/auth.md
   migration-guide/migration-guide.md
   shutdown/shutdown.md
   api/index

Contents
========

* :doc:`Getting Started <getting-started/getting-started>` - Installing the driver and executing your first queries
* :doc:`Executing Statements <statements/index>` - Prepared vs unprepared, single vs batch, paged vs unpaged queries
* :doc:`Paging <paging/paging>` - Fetching large result sets efficiently
* :doc:`Load Balancing <policies/load-balancing>` - Configuring routing policies
* :doc:`Retry Policies <policies/retry-policy>` - Configuring retry behavior
* :doc:`Data Types <data-types/data-types>` - CQL type mappings and type hints
* :doc:`Authentication <auth/auth>` - Connecting with credentials and SSL
* :doc:`Migration Guide <migration-guide/migration-guide>` - Migrating from the DataStax Node.js driver
* :doc:`Shutdown <shutdown/shutdown>` - Connection lifecycle
* :doc:`API Reference <api/index>`

Other documentation
===================

* `Examples <https://github.com/scylladb/nodejs-rs-driver/tree/main/examples>`_
* `ScyllaDB documentation <https://docs.scylladb.com/stable/>`_
