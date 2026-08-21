# Client Routes (Private Networking)

When connecting to ScyllaDB Cloud clusters over private networking (e.g. AWS PrivateLink or
GCP Private Service Connect), nodes are not reachable at the addresses they broadcast to each
other. Each node is instead reachable through a proxy whose address is stored in the
`system.client_routes` table. The driver has to be told to route through that table — that is
what the **Client Routes** feature does.

## How it works

1. Each proxy is identified by a **connection id** — a string the cloud infrastructure
   assigns to a particular PrivateLink / Private Service Connect connection.
2. On session startup, and on every metadata refresh, the driver reads `system.client_routes`
   to find which address and port to use for each node, filtered by the configured connection ids.
3. The driver subscribes to `CLIENT_ROUTES_CHANGE` events, so it can pick up changes to the table
   without waiting for a full metadata refresh.

## Usage

Provide a `clientRoutes` option alongside `contactPoints`:

```javascript
const { Client } = require('@scylladb/driver');

(async () => {
  const client = new Client({
    contactPoints: ['my-privatelink-endpoint.amazonaws.com:9042'],
    localDataCenter: 'datacenter1',
    clientRoutes: {
      proxies: [
        { connectionId: 'my-connection-id' },
      ],
    },
  });

  await client.connect();
})();
```

`contactPoints` is still required — use the address your cloud setup gives you for the
initial connection. Contact points are never translated, which is what makes the first connection
possible before any route is known.

## Proxies

`clientRoutes.proxies` is a non-empty array; each entry identifies one ScyllaDB Cloud connection
to read routes for:

| Option             | Description                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connectionId`     | The ScyllaDB Cloud connection id. Used to filter the rows of `system.client_routes` that apply to this proxy. This is required.                          |
| `hostnameOverride` | Overrides the hostname that would otherwise be read from `system.client_routes` for this connection id. Useful for e.g. local testing.  |

More than one proxy can be specified when connecting, for example one per availability zone -
pass all of them in `clientRoutes.proxies`.

```javascript
clientRoutes: {
  proxies: [
    { connectionId: 'conn-id-az-1' },
    { connectionId: 'conn-id-az-2' },
  ],
},
```

## Restrictions

`clientRoutes` is mutually exclusive with:

- **`policies.addressResolution`** — client routes performs its own Host ID based address
  translation, so a custom address translator would conflict with it.
- **`sslOptions`** — TLS is not yet supported for client routes connections.

Combining either with `clientRoutes` throws when the client is created.

## Limitations

- **Mixed clusters are not supported.** Every node must be reachable through client routes, and so
  must have a corresponding entry in `system.client_routes`. A cluster where some nodes are behind
  private networking and others are reachable directly will not work.
- _Advanced_ shard awareness (the driver picking a source port to target a specific shard) is
  disabled, because the proxy infrastructure does not preserve it. _Basic_ shard awareness still
  works, so requests are still routed to the correct shard.
