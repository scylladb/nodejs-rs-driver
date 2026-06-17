# Authentication

The Node.js RS Driver supports both username/password authentication and SSL/TLS connections.

> **Important:** Authentication credentials are sent in plain text to the server. For this reason,
> it is strongly recommended to use authentication together with SSL/TLS encryption, or only in
> a trusted network environment.

## Username and Password Authentication

To connect with username/password credentials, provide them in the `credentials` option:

```javascript
const { Client } = require('@scylladb/driver');

(async () => {
  const client = new Client({
    contactPoints: ['127.0.0.1'],
    localDataCenter: 'datacenter1',
    credentials: {
      username: 'cassandra',
      password: 'cassandra',
    },
  });

  await client.connect();
})();
```

The `credentials` object accepts:

- `username` - the username to authenticate with
- `password` - the password to authenticate with

These map directly to ScyllaDB's built-in `PasswordAuthenticator`. Ensure that the authenticator
is enabled in your ScyllaDB configuration (`authenticator: PasswordAuthenticator` in `scylla.yaml`).

## SSL/TLS

To connect over SSL, provide an `sslOptions` object. The SSL options are passed directly to Node.js's
[`tls.connect()`](https://nodejs.org/api/tls.html#tlsconnectoptions-callback):

```javascript
const fs = require('fs');
const { Client } = require('@scylladb/driver');

(async () => {
  const client = new Client({
    contactPoints: ['127.0.0.1'],
    localDataCenter: 'datacenter1',
    sslOptions: {
      ca: fs.readFileSync('/path/to/ca.crt'),
      cert: fs.readFileSync('/path/to/client.crt'),
      key: fs.readFileSync('/path/to/client.key'),
      rejectUnauthorized: true,
    },
  });

  await client.connect();
})();
```

Common SSL options:

| Option               | Description                                                   |
|----------------------|---------------------------------------------------------------|
| `ca`                 | CA certificate (Buffer or string) to verify the server cert  |
| `cert`               | Client certificate for mutual TLS authentication             |
| `key`                | Client private key for mutual TLS authentication             |
| `rejectUnauthorized` | Whether to reject connections with invalid certificates       |

## Using Both Authentication and SSL

You can combine username/password authentication with SSL for secure connections:

```javascript
const fs = require('fs');
const { Client } = require('@scylladb/driver');

(async () => {
  const client = new Client({
    contactPoints: ['127.0.0.1'],
    localDataCenter: 'datacenter1',
    credentials: {
      username: 'cassandra',
      password: 'cassandra',
    },
    sslOptions: {
      ca: fs.readFileSync('/path/to/ca.crt'),
      rejectUnauthorized: true,
    },
  });

  await client.connect();
})();
```
