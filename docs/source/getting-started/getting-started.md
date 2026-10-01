# Getting Started

This page will guide you through installing the Node.js RS Driver and executing your first statements against ScyllaDB.

## Installation

Install the driver using npm:

```bash
npm install @scylladb/driver
```

**Supported architectures:** Linux x86_64 and Linux ARM.

## Connecting to ScyllaDB

Create a `Client` instance and connect to your ScyllaDB cluster:

```javascript
const { Client } = require('@scylladb/driver');

(async () => {
  const client = new Client({
    contactPoints: ['127.0.0.1'],
    localDataCenter: 'datacenter1',
  });

  await client.connect();
  console.log('Connected to ScyllaDB');
})();
```

For connecting with authentication, see the [Authentication](../connecting/authentication.md) page.

### Driver configuration reporting

The control connection reports a JSON description of the configuration visible to the underlying
Rust session in the `DRIVER_CONFIG` CQL startup option. It covers native connection, control-plane,
and query-policy settings. The report's `query.defaults` entries contain native Rust defaults. They
may differ from the Node.js query defaults and execution-profile overrides applied to individual
statements.

ScyllaDB servers with a `client_options` column (available since ScyllaDB 2026.1) expose the report
in `system.clients.client_options`, alongside the `SESSION_ID` shared by every connection from the
same `Client`. Earlier server versions receive these startup options but do not expose them through
that table. `system.clients` is node-local, and only the control connection sends `DRIVER_CONFIG`,
so inspect each node or direct the query to the node hosting the control connection to find the
report.

Reporting is enabled by default. Disable it when the client configuration must not be disclosed to
the cluster:

```javascript
const client = new Client({
  contactPoints: ['127.0.0.1'],
  localDataCenter: 'datacenter1',
  driverConfigReportingEnabled: false,
});
```

Disabling configuration reporting does not disable `SESSION_ID`.

## Executing a Statement

Once connected, you can execute CQL statements. It is strongly recommended to use **prepared statements** for repeated operations, as they improve performance and enable advanced load balancing:

```javascript
// Prepared statement (recommended for repeated execution)
const result = await client.execute(
  'SELECT keyspace_name FROM system_schema.keyspaces',
  [],
  { prepare: true }
);

for (const row of result.rows) {
  console.log(row['keyspace_name']);
}
```

For a detailed overview of statement types and best practices, see [Executing CQL statements](../statements/index.md).

## Full Example: Create Table and Insert Data

The following example creates a keyspace and table, inserts a row, and reads it back:

```javascript
const { Client, types } = require('@scylladb/driver');

async function main() {
  const client = new Client({
    contactPoints: ['127.0.0.1'],
    localDataCenter: 'datacenter1',
  });

  await client.connect();

  // Create a keyspace
  await client.execute(
    `CREATE KEYSPACE IF NOT EXISTS examples
     WITH replication = {'class': 'NetworkTopologyStrategy', 'datacenter1': 1}`
  );

  // Create a table
  await client.execute(
    `CREATE TABLE IF NOT EXISTS examples.basic (
       id uuid PRIMARY KEY,
       name text,
       value int
     )`
  );

  // Insert a row using a prepared statement
  const id = types.Uuid.random();
  await client.execute(
    'INSERT INTO examples.basic (id, name, value) VALUES (?, ?, ?)',
    [id, 'Hello, ScyllaDB!', 42],
    { prepare: true }
  );

  // Read the row back
  const result = await client.execute(
    'SELECT id, name, value FROM examples.basic WHERE id = ?',
    [id],
    { prepare: true }
  );

  const row = result.first();
  console.log(`id: ${row['id']}, name: ${row['name']}, value: ${row['value']}`);

  await client.shutdown();
}

main().catch(console.error);
```

## Next Steps

- [Executing CQL statements - best practices](../statements/index.md) - Learn about prepared, unprepared, and batch statements
- [Fetching large result sets](../paging/paging.md) - Page through large query results efficiently
- [Load balancing](../policies/load-balancing.md) - Configure how the driver routes requests
- [Authentication](../connecting/authentication.md) - Connect with credentials or SSL
- [Migration guide](../migration-guide/migration-guide.md) - Migrating from the Apache `cassandra-driver`
- [Examples](https://github.com/scylladb/nodejs-rs-driver/tree/main/examples) - More complete usage examples
