# Load balancing

We recommend to configure load balancing options using only `DefaultLoadBalancingPolicy`.
While some of the other built-in policies that were present in the DataStax driver,
are still supported by this driver, usage of those policies in new projects is discouraged.

If you are transferring from the DataStax driver, and would like to continue using
existing policies, see [migration guide](./migration_guide.md#load-balancing-policies) for more information.

## Configuring a DefaultLoadBalancingPolicy

`DefaultLoadBalancingPolicy` can be configured only at its creation.
The following fields can be configured:

- `preferDatacenter` (default: `null` - no preference)
- `preferRack` (default: `null` - no preference)
- `tokenAware` (default: `true`)
- `permitDcFailover` (default: `false`)
- `enableShufflingReplicas` (default: `true`)
- `allowList` (default: `null` - all hosts are accepted)

You can assume `undefined` is equivalent to `null` for the purpose of all configurations.

You can set all, or only some of those options:

```js
const DefaultLoadBalancingPolicy = require("scylladb-driver-alpha").policies.loadBalancing.DefaultLoadBalancingPolicy;

let policy = new DefaultLoadBalancingPolicy({
    preferDatacenter: "my_dc",
    preferRack: "my_rack",
    permitDcFailover: true,
    enableShufflingReplicas: true
});

```

## Semantics of DefaultLoadBalancingPolicy

### Preferences

The `preferDatacenter` and `preferRack` fields in `DefaultLoadBalancingPolicy` allow the load balancing
policy to prioritize nodes based on their location. It has three modes:

- no preference (none of the fields are provided)
- preferred datacenter (only `preferDatacenter` is provided)
- preferred datacenter and rack (both fields are provided)

When a datacenter `"my_dc"` is preferred, the policy will treat nodes in `"my_dc"`
as "local" nodes, and nodes in other datacenters as "remote" nodes. This affects
the order in which nodes are returned by the policy when selecting nodes for
read or write operations. If no datacenter is preferred, the policy will treat
all nodes as local nodes.

Preferences allow the load balancing policy to prioritize nodes based on their
availability zones (racks) in the preferred datacenter, too. When a datacenter
and a rack are preferred, the policy will first return replicas in the local rack
in the preferred datacenter, and then the other replicas in the datacenter
(followed by remote replicas). After replicas, the other nodes will be ordered
similarly, too (local rack nodes, local datacenter nodes, remote nodes).

When datacenter failover is disabled (`permitDcFailover` is set to
false), the default policy will only include local nodes in load balancing
plans. Remote nodes will be excluded, even if they are alive and available to
serve requests.

### Datacenter Failover

In the event of a datacenter outage or network failure, the nodes in that
datacenter may become unavailable, and clients may no longer be able to access
the data stored on those nodes. To address this, the `DefaultLoadBalancingPolicy`
supports datacenter failover, which allows to route requests to nodes in other
datacenters if the local nodes are unavailable.

Datacenter failover can be enabled in `DefaultLoadBalancingPolicy` by
`permitDcFailover` option. When this option is set to `true`, the policy will
prefer to return alive remote replicas if datacenter failover is permitted and
possible due to consistency constraints.

### Token awareness

Token awareness refers to a mechanism by which the driver is aware of the token
range assigned to each node in the cluster. Tokens are assigned to nodes to
partition the data and distribute it across the cluster.

When a user wants to read or write data, the driver can use token awareness to
route the request to the correct node based on the token range of the data
being accessed. This can help to minimize network traffic and improve
performance by ensuring that the data is accessed locally as much as possible.

In the case of `DefaultLoadBalancingPolicy`, token awareness is enabled by default,
meaning that the policy will prefer to return alive local replicas if the token is
available. This means that if the client is requesting data that falls within
the token range of a particular node, the policy will try to route the request
to that node first, assuming it is alive and responsive.

Token awareness can significantly improve the performance and scalability of
applications built on Scylla. By using token awareness, users can ensure that
data is accessed locally as much as possible, reducing network overhead and
improving throughput.

Please note that for token awareness to be applied, a statement must be
prepared before being executed.

### Replica shuffling

Setting `enableShufflingReplicas` to `false` (default: `true`) does something
slightly different than its name suggests. It will cause all randomness-based
operations on replicas, like selecting random one or shuffling a list of them,
to always use PRNG with the same seed.
The setting has no effect for non-replica nodes. Those are always shuffled
randomly, without predefined seed. For that reason, this setting has no effect
if token awareness is disabled.
This is mostly useful in testing, to make sure subsequent calls to the policy
return replicas in the same order. We discourage its use in production setting.

### Allow list

You may want to limit the driver ability to connect to certain nodes.
It can be achieved by providing an allow list - list of hosts in
`ip:port` format, that can be used, when connecting to the database.
When this option is provided, any of the hosts that is not on the allow
list will be ignored when connecting to the database.
When this option is empty (set to `null`), all hosts (unless filtered by other load balancing options)
can be used when connecting to the database.
