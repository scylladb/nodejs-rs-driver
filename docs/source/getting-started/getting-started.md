# Getting Started

This guide walks you through connecting to ScyllaDB using the ScyllaDB Node.js-RS Driver
and executing your first queries.

## Installation

Install the driver using npm:

```bash
npm install scylladb-driver-alpha
```

> **Note:** Currently only Linux x86_64 and aarch64 architectures are supported.

## Connecting to ScyllaDB

Create a `Client` instance and call `connect()`:

```javascript
const cassandra = require("scylladb-driver-alpha");

const client = new cassandra.Client({
  contactPoints: ["127.0.0.1:9042"],
  localDataCenter: "datacenter1",
});

async function run() {
  await client.connect();
  console.log("Connected to ScyllaDB");
  await client.shutdown();
}

run();
```

You can print the cluster hosts discovered after connecting:

```javascript
const cassandra = require("scylladb-driver-alpha");

const contactPoint = process.env.SCYLLA_URI || "172.17.0.2:9042";
const client = new cassandra.Client({ contactPoints: [contactPoint] });

async function run() {
  await client.connect();
  client.hosts.forEach(function (host) {
    console.log(host.address, host.datacenter, host.rack);
  });
  await client.shutdown();
}

run().catch(console.error);
```

## Executing a Query

Use `client.execute()` to run a CQL query:

```javascript
const cassandra = require("scylladb-driver-alpha");

const contactPoint = process.env.SCYLLA_URI || "172.17.0.2:9042";
const client = new cassandra.Client({ contactPoints: [contactPoint] });

async function run() {
  await client.connect();
  const result = await client.execute("SELECT * FROM system.local");
  console.log("Row:", result.rows[0]);
  await client.shutdown();
}

run().catch(console.error);
```

## Full Example: Create Table and Insert Data

The following example creates a keyspace and table, inserts a row, and reads it back:

```javascript
const cassandra = require("scylladb-driver-alpha");

const contactPoint = process.env.SCYLLA_URI || "172.17.0.2:9042";
const client = new cassandra.Client({ contactPoints: [contactPoint] });

async function run() {
  await client.connect();

  await client.execute(
    "CREATE KEYSPACE IF NOT EXISTS examples " +
    "WITH replication = { 'class': 'SimpleStrategy', 'replication_factor': '1' }"
  );
  await client.execute(
    "CREATE TABLE IF NOT EXISTS examples.basic " +
    "(id uuid PRIMARY KEY, txt text, val int)"
  );

  const id = cassandra.types.Uuid.random();
  await client.execute(
    "INSERT INTO examples.basic (id, txt, val) VALUES (?, ?, ?)",
    [id, "Hello!", 42],
    { prepare: true }
  );

  const result = await client.execute(
    "SELECT * FROM examples.basic WHERE id = ?",
    [id],
    { prepare: true }
  );
  console.log("Row:", result.rows[0]);

  await client.shutdown();
}

run().catch(console.error);
```

## Next Steps

- [Executing Statements](../statements/statements.md) — prepared vs unprepared, paged vs unpaged
- [Paging](../paging/paging.md) — fetching large result sets efficiently
- [Batch Statements](../batch/batch.md) — atomic multi-statement execution
- [Load Balancing](../load-balancing/load-balancing.md) — configuring routing policies
- [Data Types](../data-types/data-types.md) — CQL type mappings and type hints
- [Authentication](../auth/auth.md) — connecting with credentials
