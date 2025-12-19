"use strict";

const types = require("../types");
const utils = require("../utils.js");
const errors = require("../errors.js");
const { throwNotSupported } = require("../new-utils.js");

const newlyUpInterval = 60000;

/** @module policies/loadBalancing */
/**
 * Base class for Load Balancing Policies
 */
class LoadBalancingPolicy {
    constructor() {}
    /**
     * Initializes the load balancing policy, called after the driver obtained the information of the cluster.
     * @param {Client} client
     * @param {HostMap} hosts
     * @param {Function} callback
     */
    init(client, hosts, callback) {
        this.client = client;
        this.hosts = hosts;
        callback();
    }
    /**
     * Returns the distance assigned by this policy to the provided host.
     * @param {Host} host
     */
    getDistance(host) {
        return types.distance.local;
    }
    /**
     * Returns an iterator with the hosts for a new query.
     * Each new query will call this method. The first host in the result will
     * then be used to perform the query.
     * @param {String} keyspace Name of currently logged keyspace at `Client` level.
     * @param {ExecutionOptions|null} executionOptions The information related to the execution of the request.
     * @param {Function} callback The function to be invoked with the error as first parameter and the host iterator as
     * second parameter.
     */
    newQueryPlan(keyspace, executionOptions, callback) {
        callback(
            new Error(
                "You must implement a query plan for the LoadBalancingPolicy class",
            ),
        );
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions() {
        return new Map();
    }

    /**
     * @returns {LoadBalancingConfig}
     * @package
     */
    getRustConfiguration() {
        // This error will be thrown by all policies, that do not override this method.
        throw new Error(
            "Currently this load balancing policy is not supported by the driver",
        );
    }
}

class LoadBalancingRustImplemented extends LoadBalancingPolicy {
    constructor() {
        super();
        this.errorMsg =
            "This load balancing policy is implemented in Rust. " +
            "Using this policy from JavaScript, or inheriting from this class " +
            "in order to create custom policies is not supported.";
    }
    init(client, hosts, callback) {
        throwNotSupported(this.errorMsg);
    }
    getDistance(host) {
        throwNotSupported(this.errorMsg);
    }
    newQueryPlan(keyspace, executionOptions, callback) {
        throwNotSupported(this.errorMsg);
    }
}

/**
 * This policy yield nodes in a round-robin fashion.
 * @extends LoadBalancingPolicy
 */
class RoundRobinPolicy extends LoadBalancingRustImplemented {
    constructor() {
        super();
        this.index = 0;
    }
    /**
     * @returns {LoadBalancingConfig}
     */
    getRustConfiguration() {
        return {
            tokenAware: false,
        };
    }
}

/**
 * A data-center aware Round-robin load balancing policy.
 * This policy provides round-robin queries over the nodes of the local
 * data center.
 * @extends {LoadBalancingPolicy}
 */
class DCAwareRoundRobinPolicy extends LoadBalancingRustImplemented {
    /**
     * @param {?String} [localDc] local datacenter name.  This value overrides the 'localDataCenter' Client option \
     * and is useful for cases where you have multiple execution profiles that you intend on using for routing
     * requests to different data centers.
     */
    constructor(localDc) {
        super();
        this.localDc = localDc;
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions() {
        return new Map([["localDataCenter", this.localDc]]);
    }

    /**
     * @returns {LoadBalancingConfig}
     */
    getRustConfiguration() {
        return {
            preferDatacenter: this.localDc,
            permitDcFailover: false,
            tokenAware: false,
        };
    }
}

/**
 * A wrapper load balancing policy that add token awareness to a child policy.
 * @extends LoadBalancingPolicy
 */
class TokenAwarePolicy extends LoadBalancingRustImplemented {
    /**
     * @param {LoadBalancingPolicy} childPolicy
     */
    constructor(childPolicy) {
        super();
        if (!childPolicy) {
            throw new Error("You must specify a child load balancing policy");
        }
        this.childPolicy = childPolicy;
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions() {
        const map = new Map([
            [
                "childPolicy",
                this.childPolicy.constructor !== undefined
                    ? this.childPolicy.constructor.name
                    : null,
            ],
        ]);

        if (this.childPolicy instanceof DCAwareRoundRobinPolicy) {
            map.set("localDataCenter", this.childPolicy.localDc);
        }

        return map;
    }

    /**
     * @returns {LoadBalancingConfig}
     */
    getRustConfiguration() {
        let options = this.childPolicy.getRustConfiguration();
        options.tokenAware = true;
        return options;
    }
}

/**
 * A load balancing policy wrapper that ensure that only hosts from a provided
 * allow list will ever be returned.
 *
 * This policy wraps another load balancing policy and will delegate the choice
 * of hosts to the wrapped policy with the exception that only hosts contained
 * in the allow list provided when constructing this policy will ever be
 * returned. Any host not in the while list will be considered ignored
 * and thus will not be connected to.
 *
 * This policy can be useful to ensure that the driver only connects to a
 * predefined set of hosts. Keep in mind however that this policy defeats
 * somewhat the host auto-detection of the driver. As such, this policy is only
 * useful in a few special cases or for testing, but is not optimal in general.
 * If all you want to do is limiting connections to hosts of the local
 * data-center then you should use DCAwareRoundRobinPolicy and *not* this policy
 * in particular.
 *
 * @extends LoadBalancingPolicy
 */
class AllowListPolicy extends LoadBalancingPolicy {
    /**
     * Create a new policy that wraps the provided child policy but only "allow" hosts
     * from the provided list.
     * @param {LoadBalancingPolicy} childPolicy the wrapped policy.
     * @param {Array.<string>}  allowList The hosts address in the format ipAddress:port.
     * Only hosts from this list may get connected
     * to (whether they will get connected to or not depends on the child policy).
     */
    constructor(childPolicy, allowList) {
        super();
        if (!childPolicy) {
            throw new Error("You must specify a child load balancing policy");
        }
        if (!Array.isArray(allowList)) {
            throw new Error(
                "You must provide the list of allowed host addresses",
            );
        }

        this.childPolicy = childPolicy;
        this.allowList = new Map(allowList.map((address) => [address, true]));
    }
    init(client, hosts, callback) {
        this.childPolicy.init(client, hosts, callback);
    }
    /**
     * Uses the child policy to return the distance to the host if included in the allow list.
     * Any host not in the while list will be considered ignored.
     * @param host
     */
    getDistance(host) {
        if (!this._contains(host)) {
            return types.distance.ignored;
        }
        return this.childPolicy.getDistance(host);
    }
    /**
     * @param {Host} host
     * @returns {boolean}
     * @private
     */
    _contains(host) {
        return !!this.allowList.get(host.address);
    }
    /**
     * Returns the hosts to use for a new query filtered by the allow list.
     */
    newQueryPlan(keyspace, info, callback) {
        const self = this;
        this.childPolicy.newQueryPlan(keyspace, info, function (err, iterator) {
            if (err) {
                return callback(err);
            }
            callback(null, self._filter(iterator));
        });
    }
    _filter(childIterator) {
        const self = this;
        return {
            next: function () {
                const item = childIterator.next();
                if (!item.done && !self._contains(item.value)) {
                    return this.next();
                }
                return item;
            },
        };
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions() {
        return new Map([
            [
                "childPolicy",
                this.childPolicy.constructor !== undefined
                    ? this.childPolicy.constructor.name
                    : null,
            ],
            ["allowList", Array.from(this.allowList.keys())],
        ]);
    }
}

/**
 * A load-balancing policy implementation that attempts to fairly distribute the load based on the amount of in-flight
 * request per hosts. The local replicas are initially shuffled and
 * <a href="https://www.eecs.harvard.edu/~michaelm/postscripts/mythesis.pdf">between the first two nodes in the
 * shuffled list, the one with fewer in-flight requests is selected as coordinator</a>.
 *
 *
 * Additionally, it detects unresponsive replicas and reorders them at the back of the query plan.
 *
 * For graph analytics queries, it uses the preferred analytics graph server previously obtained by driver as first
 * host in the query plan.
 */
class LegacyDefaultLoadBalancingPolicy extends LoadBalancingPolicy {
    /**
     * Creates a new instance of `LegacyDefaultLoadBalancingPolicy`.
     * @param {String|Object} [options] The local data center name or the optional policy options object.
     *
     * Note that when providing the local data center name, it overrides `localDataCenter` option at
     * `Client` level.
     * @param {String} [options.localDc] local data center name.  This value overrides the 'localDataCenter' Client option
     * and is useful for cases where you have multiple execution profiles that you intend on using for routing
     * requests to different data centers.
     * @param {Function} [options.filter] A function to apply to determine if hosts are included in the query plan.
     * The function takes a Host parameter and returns a Boolean.
     */
    constructor(options) {
        super();

        if (typeof options === "string") {
            options = { localDc: options };
        } else if (!options) {
            options = utils.emptyObject;
        }

        this._client = null;
        this._hosts = null;
        this._filteredHosts = null;
        this._preferredHost = null;
        this._index = 0;
        this.localDc = options.localDc;
        this._filter = options.filter || this._defaultFilter;

        // Allow some checks to be injected
        if (options.isHostNewlyUp) {
            this._isHostNewlyUp = options.isHostNewlyUp;
        }
        if (options.healthCheck) {
            this._healthCheck = options.healthCheck;
        }
        if (options.compare) {
            this._compare = options.compare;
        }
        if (options.getReplicas) {
            this._getReplicas = options.getReplicas;
        }
    }

    /**
     * Initializes the load balancing policy, called after the driver obtained the information of the cluster.
     * @param {Client} client
     * @param {HostMap} hosts
     * @param {Function} callback
     */
    init(client, hosts, callback) {
        this._client = client;
        this._hosts = hosts;

        // Clean local host cache
        this._hosts.on("add", () => (this._filteredHosts = null));
        this._hosts.on("remove", () => (this._filteredHosts = null));

        try {
            setLocalDc(this, client, this._hosts);
        } catch (err) {
            return callback(err);
        }

        callback();
    }

    /**
     * Returns the distance assigned by this policy to the provided host, relatively to the client instance.
     * @param {Host} host
     */
    getDistance(host) {
        if (this._preferredHost !== null && host === this._preferredHost) {
            // Set the last preferred host as local.
            // It ensures that the pool for the graph analytics host has the appropriate size
            return types.distance.local;
        }

        if (!this._filter(host)) {
            return types.distance.ignored;
        }

        return host.datacenter === this.localDc
            ? types.distance.local
            : types.distance.ignored;
    }

    /**
     * Returns a host iterator to be used for a query execution.
     * @override
     * @param {String} keyspace
     * @param {ExecutionOptions} executionOptions
     * @param {Function} callback
     */
    newQueryPlan(keyspace, executionOptions, callback) {
        let routingKey;
        let preferredHost;

        if (executionOptions) {
            routingKey = executionOptions.getRoutingKey();

            if (executionOptions.getKeyspace()) {
                keyspace = executionOptions.getKeyspace();
            }

            preferredHost = executionOptions.getPreferredHost();
        }

        let iterable;

        if (!keyspace || !routingKey) {
            iterable = this._getLocalHosts();
        } else {
            iterable = this._getReplicasAndLocalHosts(keyspace, routingKey);
        }

        if (preferredHost) {
            // Set it on an instance level field to set the distance
            this._preferredHost = preferredHost;
            iterable = LegacyDefaultLoadBalancingPolicy._getPreferredHostFirst(
                preferredHost,
                iterable,
            );
        }

        return callback(null, iterable);
    }

    /**
     * Yields the preferred host first, followed by the host in the provided iterable
     * @param preferredHost
     * @param iterable
     * @private
     */
    static *_getPreferredHostFirst(preferredHost, iterable) {
        yield preferredHost;

        for (const host of iterable) {
            if (host !== preferredHost) {
                yield host;
            }
        }
    }

    /**
     * Yields the local hosts without the replicas already yielded
     * @param {Array<Host>} [localReplicas] The local replicas that we should avoid to include again
     * @private
     */
    *_getLocalHosts(localReplicas) {
        // Use a local reference
        const hosts = this._getFilteredLocalHosts();
        const initialIndex = this._getIndex();

        // indexOf() over an Array is a O(n) operation but given that there should be 3 to 7 replicas,
        // it shouldn't be an expensive call. Additionally, this will only be executed when the local replicas
        // have been exhausted in a lazy manner.
        const canBeYield = localReplicas
            ? (h) => localReplicas.indexOf(h) === -1
            : (h) => true;

        for (let i = 0; i < hosts.length; i++) {
            const h = hosts[(i + initialIndex) % hosts.length];
            if (canBeYield(h) && h.isUp()) {
                yield h;
            }
        }
    }

    _getReplicasAndLocalHosts(keyspace, routingKey) {
        let replicas = this._getReplicas(keyspace, routingKey);
        if (replicas === null) {
            return this._getLocalHosts();
        }

        const filteredReplicas = [];
        let newlyUpReplica = null;
        let newlyUpReplicaTimestamp = Number.MIN_SAFE_INTEGER;
        let unhealthyReplicas = 0;

        // Filter by DC, predicate and UP replicas
        // Use the same iteration to perform other checks: whether if its newly UP or unhealthy
        // As this is part of the hot path, we use a simple loop and avoid using Array.prototype.filter() + closure
        for (let i = 0; i < replicas.length; i++) {
            const h = replicas[i];
            if (
                !this._filter(h) ||
                h.datacenter !== this.localDc ||
                !h.isUp()
            ) {
                continue;
            }
            const isUpSince = this._isHostNewlyUp(h);
            if (isUpSince !== null && isUpSince > newlyUpReplicaTimestamp) {
                newlyUpReplica = h;
                newlyUpReplicaTimestamp = isUpSince;
            }
            if (newlyUpReplica === null && !this._healthCheck(h)) {
                unhealthyReplicas++;
            }
            filteredReplicas.push(h);
        }

        replicas = filteredReplicas;

        // Shuffle remaining local replicas
        utils.shuffleArray(replicas);

        if (replicas.length < 3) {
            // Avoid reordering replicas of a set of 2 as we could be doing more harm than good
            return this.yieldReplicasFirst(replicas);
        }

        let temp;

        if (newlyUpReplica === null) {
            if (
                unhealthyReplicas > 0 &&
                unhealthyReplicas < Math.floor(replicas.length / 2 + 1)
            ) {
                // There is one or more unhealthy replicas and there is a majority of healthy replicas
                this._sendUnhealthyToTheBack(replicas, unhealthyReplicas);
            }
        } else if (
            (newlyUpReplica === replicas[0] ||
                newlyUpReplica === replicas[1]) &&
            Math.random() * 4 >= 1
        ) {
            // There is a newly UP replica and the replica in first or second position is the most recent replica
            // marked as UP and dice roll 1d4!=1 -> Send it to the back of the Array
            const index = newlyUpReplica === replicas[0] ? 0 : 1;
            temp = replicas[replicas.length - 1];
            replicas[replicas.length - 1] = replicas[index];
            replicas[index] = temp;
        }

        if (this._compare(replicas[1], replicas[0]) > 0) {
            // Power of two random choices
            temp = replicas[0];
            replicas[0] = replicas[1];
            replicas[1] = temp;
        }

        return this.yieldReplicasFirst(replicas);
    }

    /**
     * Yields the local replicas followed by the rest of local nodes.
     * @param {Array<Host>} replicas The local replicas
     */
    *yieldReplicasFirst(replicas) {
        for (let i = 0; i < replicas.length; i++) {
            yield replicas[i];
        }
        yield* this._getLocalHosts(replicas);
    }

    _isHostNewlyUp(h) {
        return h.isUpSince !== null &&
            Date.now() - h.isUpSince < newlyUpInterval
            ? h.isUpSince
            : null;
    }

    /**
     * Returns a boolean determining whether the host health is ok or not.
     * A Host is considered unhealthy when there are enough items in the queue (10 items in-flight) but the
     * Host is not responding to those requests.
     * @param {Host} h
     * @return {boolean}
     * @private
     */
    _healthCheck(h) {
        return !(h.getInFlight() >= 10 && h.getResponseCount() <= 1);
    }

    /**
     * Compares to host and returns 1 if it needs to favor the first host otherwise, -1.
     * @return {number}
     * @private
     */
    _compare(h1, h2) {
        return h1.getInFlight() < h2.getInFlight() ? 1 : -1;
    }

    _getReplicas(keyspace, routingKey) {
        return this._client.getReplicas(keyspace, routingKey);
    }

    /**
     * Returns an Array of hosts filtered by DC and predicate.
     * @returns {Array<Host>}
     * @private
     */
    _getFilteredLocalHosts() {
        if (this._filteredHosts === null) {
            this._filteredHosts = this._hosts
                .values()
                .filter(
                    (h) => this._filter(h) && h.datacenter === this.localDc,
                );
        }
        return this._filteredHosts;
    }

    _getIndex() {
        const result = this._index++;
        // Overflow protection
        if (this._index === 0x7fffffff) {
            this._index = 0;
        }
        return result;
    }

    _sendUnhealthyToTheBack(replicas, unhealthyReplicas) {
        let counter = 0;

        // Start from the back, move backwards and stop once all unhealthy replicas are at the back
        for (
            let i = replicas.length - 1;
            i >= 0 && counter < unhealthyReplicas;
            i--
        ) {
            const host = replicas[i];
            if (this._healthCheck(host)) {
                continue;
            }

            const targetIndex = replicas.length - 1 - counter;
            if (targetIndex !== i) {
                const temp = replicas[targetIndex];
                replicas[targetIndex] = host;
                replicas[i] = temp;
            }
            counter++;
        }
    }

    _defaultFilter() {
        return true;
    }

    /**
     * Gets an associative array containing the policy options.
     */
    getOptions() {
        return new Map([
            ["localDataCenter", this.localDc],
            ["filterFunction", this._filter !== this._defaultFilter],
        ]);
    }
}

/**
 * Validates and sets the local data center to be used.
 * @param {LoadBalancingPolicy} lbp
 * @param {Client} client
 * @param {HostMap} hosts
 * @private
 */
function setLocalDc(lbp, client, hosts) {
    if (!(lbp instanceof LoadBalancingPolicy)) {
        throw new errors.DriverInternalError(
            "LoadBalancingPolicy instance was not provided",
        );
    }

    if (client && client.options) {
        if (lbp.localDc && !client.options.localDataCenter) {
            client.log(
                "info",
                `Local data center '${lbp.localDc}' was provided as an argument to the load-balancing` +
                    ` policy. It is preferable to specify the local data center using 'localDataCenter' in Client` +
                    ` options instead when your application is targeting a single data center.`,
            );
        }

        // If localDc is unset, use value set in client options.
        lbp.localDc = lbp.localDc || client.options.localDataCenter;
    }

    const dcs = getDataCenters(hosts);

    if (!lbp.localDc) {
        throw new errors.ArgumentError(
            `'localDataCenter' is not defined in Client options and also was not specified in constructor.` +
                ` At least one is required. Available DCs are: [${Array.from(dcs)}]`,
        );
    }

    if (!dcs.has(lbp.localDc)) {
        throw new errors.ArgumentError(
            `Datacenter ${lbp.localDc} was not found. Available DCs are: [${Array.from(dcs)}]`,
        );
    }
}

/**
 * This load balancing policy replicates the behavior of the Rust Driver Default Load Balancing Policy.
 *
 * It can be configured to be datacenter-aware, rack-aware and token-aware.
 * When the policy is datacenter-aware, you can configure whether to allow datacenter failover
 * (sending query to a node from a remote datacenter).
 */
class DefaultLoadBalancingPolicy extends LoadBalancingRustImplemented {
    /**
     * @type {LoadBalancingConfig}
     */
    #config;

    /**
     * @param {LoadBalancingConfig} [config]
     */
    constructor(config) {
        super();
        if (!config) {
            config = new LoadBalancingConfig();
        }
        this.#config = config;
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions() {
        throwNotSupported("Not implemented.");
    }

    /**
     * @returns {LoadBalancingConfig}
     * @package
     */
    getRustConfiguration() {
        return this.#config;
    }
}

/**
 * This class represents the options of the rust driver Default Load Balancing Policy.
 * This option will be used to configure that policy.
 * You can find more about this policy in the documentation:
 * https://rust-driver.docs.scylladb.com/stable/load-balancing/default-policy.html
 */
class LoadBalancingConfig {
    // Internal note: this documentation is based on the Rust Driver documentation.
    // When major changes are made there, remember to update this documentation accordingly.
    /**
     * Sets the datacenter to be preferred by this policy.
     *
     * Allows the load balancing policy to prioritize nodes based on their location.
     * When a preferred datacenter is set, the policy will treat nodes in that
     * datacenter as "local" nodes, and nodes in other datacenters as "remote" nodes.
     * This affects the order in which nodes are returned by the policy when
     * selecting replicas for read or write operations. If no preferred datacenter
     * is specified, the policy will treat all nodes as local nodes.
     *
     * When datacenter failover is disabled (`permitDcFailover` is set to false),
     * the default policy will only include local nodes in load balancing plans.
     * Remote nodes will be excluded, even if they are alive and available
     * to serve requests.
     *
     * @type {string?}
     */
    preferDatacenter;
    /**
     * This option cannot be used without setting `preferDatacenter`.
     *
     * `preferDatacenter` and `preferRack` set the datacenter and rack to be preferred by this policy.
     *
     * Allows the load balancing policy to prioritize nodes based on their location
     * as well as their availability zones in the preferred datacenter.
     *
     * When a preferred rack is set, the policy will first return replicas in the local rack
     * in the preferred datacenter, and then the other replicas in the datacenter.
     *
     * @type {string?}
     */
    preferRack;
    /**
     * Sets whether this policy is token-aware (balances load more consciously) or not.
     *
     * Token awareness refers to a mechanism by which the driver is aware
     * of the token range assigned to each node in the cluster. Tokens
     * are assigned to nodes to partition the data and distribute it
     * across the cluster.
     *
     * When a user wants to read or write data, the driver can use token awareness
     * to route the request to the correct node based on the token range of the data
     * being accessed. This can help to minimize network traffic and improve
     * performance by ensuring that the data is accessed locally as much as possible.
     *
     * In the case of `DefaultPolicy`, token awareness is enabled by default,
     * meaning that the policy will prefer to return alive local replicas
     * if the token is available. This means that if the client is requesting data
     * that falls within the token range of a particular node, the policy will try
     * to route the request to that node first, assuming it is alive and responsive.
     *
     * Token awareness can significantly improve the performance and scalability
     * of applications built on Scylla. By using token awareness, users can ensure
     * that data is accessed locally as much as possible, reducing network overhead
     * and improving throughput.
     *
     * @type {boolean?}
     */
    tokenAware;
    /**
     * Sets whether this policy permits datacenter failover, i.e. ever attempts
     * to send requests to nodes from a non-preferred datacenter.
     *
     * In the event of a datacenter outage or network failure, the nodes
     * in that datacenter may become unavailable, and clients may no longer
     * be able to access data stored on those nodes. To address this,
     * the `DefaultPolicy` supports datacenter failover, which allows routing
     * requests to nodes in other datacenters if the local nodes are unavailable.
     *
     * Datacenter failover can be enabled in `DefaultPolicy` setting this flag.
     * When it is set, the policy will prefer to return alive remote replicas
     * if datacenter failover is permitted.
     *
     *  @type {boolean?}
     */
    permitDcFailover;
    /**
     * Sets whether this policy should shuffle replicas when token-awareness
     * is enabled. Shuffling can help distribute the load over replicas, but
     * can reduce the effectiveness of caching on the database side (e.g.
     * for reads).
     *
     * This option is enabled by default. If disabled, replicas will be chosen
     * in some random order that is chosen when the load balancing policy
     * is created and will not change over its lifetime.
     *
     * @type {boolean?}
     */
    enableShufflingReplicas;
}

function getDataCenters(hosts) {
    return new Set(hosts.values().map((h) => h.datacenter));
}

module.exports = {
    AllowListPolicy,
    DCAwareRoundRobinPolicy,
    LegacyDefaultLoadBalancingPolicy,
    LoadBalancingPolicy,
    RoundRobinPolicy,
    TokenAwarePolicy,
    LoadBalancingConfig,
    DefaultLoadBalancingPolicy,
};
