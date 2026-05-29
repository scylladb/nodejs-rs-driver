# Authentication

The driver supports password-based authentication using either `credentials` in `ClientOptions`
or the `PlainTextAuthProvider` class.

## Using Credentials in ClientOptions

Pass `credentials` directly when constructing the client:

```javascript
const cassandra = require("scylladb-driver-alpha");

const client = new cassandra.Client({
  contactPoints: ["127.0.0.1:9042"],
  localDataCenter: "datacenter1",
  credentials: {
    username: "cassandra",
    password: "cassandra",
  },
});

await client.connect();
```

## Using PlainTextAuthProvider

Alternatively, use the `PlainTextAuthProvider` class:

```javascript
const cassandra = require("scylladb-driver-alpha");

const authProvider = new cassandra.auth.PlainTextAuthProvider(
  "cassandra",
  "cassandra"
);

const client = new cassandra.Client({
  contactPoints: ["127.0.0.1:9042"],
  localDataCenter: "datacenter1",
  authProvider,
});

await client.connect();
```

> **Note:** Configure either `credentials` or `authProvider`, but not both.
> Only `PlainTextAuthProvider` is currently supported as an `authProvider` value.

## SSL/TLS

To connect using SSL, pass `sslOptions` to the client. The options follow
the Node.js [`tls.connect()`](https://nodejs.org/api/tls.html) interface:

```javascript
const fs = require("fs");
const cassandra = require("scylladb-driver-alpha");

const client = new cassandra.Client({
  contactPoints: ["127.0.0.1:9042"],
  localDataCenter: "datacenter1",
  sslOptions: {
    ca: fs.readFileSync("/path/to/ca.crt"),
    cert: fs.readFileSync("/path/to/client.crt"),
    key: fs.readFileSync("/path/to/client.key"),
    rejectUnauthorized: true,
  },
});

await client.connect();
```

The following `sslOptions` fields are supported:

| Field | Type | Description |
|-------|------|-------------|
| `ca` | `string \| Buffer \| Array` | Trusted CA certificates. Replaces (does not extend) OpenSSL defaults. |
| `cert` | `string \| Buffer` | Client certificate chain in PEM format. Must be provided together with `key`. |
| `key` | `string \| Buffer` | Client private key in PEM format. Must be provided together with `cert`. |
| `pfx` | `string \| Buffer` | PFX/PKCS12 encoded private key and certificate chain. Alternative to `cert`+`key`. |
| `passphrase` | `string` | Passphrase for an encrypted `key` or `pfx`. |
| `rejectUnauthorized` | `boolean` | Reject connections with invalid certificates. Default: `true`. |
| `minVersion` | `'TLSv1' \| 'TLSv1.1' \| 'TLSv1.2' \| 'TLSv1.3'` | Minimum TLS version. Default: `'TLSv1.2'`. |
| `maxVersion` | `'TLSv1' \| 'TLSv1.1' \| 'TLSv1.2' \| 'TLSv1.3'` | Maximum TLS version. Default: `'TLSv1.3'`. |
| `ciphers` | `string` | Cipher suite specification. |
| `sigalgs` | `string` | Colon-separated list of supported signature algorithms. |
| `ecdhCurve` | `string` | Named curve(s) for ECDH key agreement. |
| `honorCipherOrder` | `boolean` | Use the server's cipher suite preferences instead of the client's. |
| `secureOptions` | `number` | OpenSSL `SSL_OP_*` bitmask options. |

> **Note:** `cert` and `key` must be provided together. `pfx` and `cert`/`key` are mutually exclusive.
