"use strict";

import types = require("../types");
import utils = require("../utils");
import errors = require("../errors");
import { throwNotSupported } from "../new-utils";
import _rust = require("../../index");
import type { Host, HostMap } from "../host";
import type { ExecutionOptions } from "../execution-options";
import type { Client, EmptyCallback } from "../..";

/**
 * Receives the error, or the iterator of hosts to use for a query.
 */
type QueryPlanCallback = (
    err?: Error | null,
    iterator?: Iterator<Host>,
) => void;

/**
 * The `init` callback as the policies actually invoke it: with no argument on
 * success, rather than with the non-optional error of {@link EmptyCallback}.
 */
type InitCallback = (err?: Error) => void;

const newlyUpInterval = 60000;

/**
 * The options {@link LegacyDefaultLoadBalancingPolicy} accepts. Besides the
 * local data center and the host filter, it takes the four checks the policy
 * makes while building a query plan, which the tests replace.
 */
interface LegacyDefaultLoadBalancingPolicyOptions {
    localDc?: string;
    filter?: (host: any) => boolean;
    isHostNewlyUp?: (host: any) => number | null;
    healthCheck?: (host: any) => boolean;
    compare?: (h1: any, h2: any) => number;
    getReplicas?: (keyspace: string, routingKey: any) => Array<Host> | null;
}

/** @module policies/loadBalancing */
/**
 * Base class for Load Balancing Policies
 */
class LoadBalancingPolicy {
    client?: Client;
    hosts?: HostMap;
    localDc?: string;

    constructor() {}
    /**
     * Initializes the load balancing policy, called after the driver obtained the information of the cluster.
     */
    init(client: Client, hosts: HostMap, callback: EmptyCallback): void {
        this.client = client;
        this.hosts = hosts;
        (callback as InitCallback)();
    }
    /**
     * Returns the distance assigned by this policy to the provided host.
     */
    getDistance(host: Host): types.distance {
        return types.distance.local;
    }
    /**
     * Returns an iterator with the hosts for a new query.
     * Each new query will call this method. The first host in the result will
     * then be used to perform the query.
     * @param keyspace Name of currently logged keyspace at `Client` level.
     * @param executionOptions The information related to the execution of the request.
     * @param callback The function to be invoked with the error as first parameter and the host iterator as
     * second parameter.
     */
    newQueryPlan(
        keyspace: string,
        executionOptions: ExecutionOptions | null,
        callback: QueryPlanCallback,
    ): void {
        callback(
            new Error(
                "You must implement a query plan for the LoadBalancingPolicy class",
            ),
        );
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map();
    }

    /**
     * @internal
     * @ignore
     */
    getRustConfiguration(): _rust.LoadBalancingConfig {
        // This error will be thrown by all policies, that do not override this method.
        throw new Error(
            "Currently this load balancing policy is not supported by the driver",
        );
    }
}

class LoadBalancingRustImplemented extends LoadBalancingPolicy {
    errorMsg: string;

    constructor() {
        super();
        this.errorMsg =
            "This load balancing policy is implemented in Rust. " +
            "Using this policy from JavaScript, or inheriting from this class " +
            "in order to create custom policies is not supported.";
    }
    init(client: Client, hosts: HostMap, callback: EmptyCallback): void {
        throwNotSupported(this.errorMsg);
    }
    getDistance(host: Host): types.distance {
        throwNotSupported(this.errorMsg);
    }
    newQueryPlan(
        keyspace: string,
        executionOptions: ExecutionOptions | null,
        callback: QueryPlanCallback,
    ): void {
        throwNotSupported(this.errorMsg);
    }
}

/**
 * This policy yield nodes in a round-robin fashion.
 * @extends LoadBalancingPolicy
 */
class RoundRobinPolicy extends LoadBalancingRustImplemented {
    index: number;

    constructor() {
        super();
        this.index = 0;
    }
    /**
     * @internal
     * @ignore
     */
    getRustConfiguration(): _rust.LoadBalancingConfig {
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
     * @param localDc local datacenter name.  This value overrides the 'localDataCenter' Client option \
     * and is useful for cases where you have multiple execution profiles that you intend on using for routing
     * requests to different data centers.
     */
    constructor(localDc?: string) {
        super();
        this.localDc = localDc;
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map<string, any>([["localDataCenter", this.localDc]]);
    }

    /**
     * @internal
     * @ignore
     */
    getRustConfiguration(): _rust.LoadBalancingConfig {
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
    childPolicy: LoadBalancingPolicy;

    constructor(childPolicy: LoadBalancingPolicy) {
        super();
        if (!childPolicy) {
            throw new Error("You must specify a child load balancing policy");
        }
        this.childPolicy = childPolicy;
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        const map = new Map<string, any>([
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
     * @internal
     * @ignore
     */
    getRustConfiguration(): _rust.LoadBalancingConfig {
        const options = this.childPolicy.getRustConfiguration();
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
class AllowListPolicy extends LoadBalancingRustImplemented {
    childPolicy: LoadBalancingPolicy;
    allowList: Array<string>;

    /**
     * Create a new policy that wraps the provided child policy but only "allow" hosts
     * from the provided list.
     * @param childPolicy the wrapped policy.
     * If the child policy filters some of the hosts out, only hosts present
     * in allow list and accepted by child policy will be contacted by the driver.
     * @param allowList The hosts address in the format ipAddress:port.
     * Only hosts from this list may get connected
     * to (whether they will get connected to or not depends on the child policy).
     */
    constructor(childPolicy: LoadBalancingPolicy, allowList: Array<string>) {
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
        this.allowList = allowList;
    }

    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map<string, any>([
            [
                "childPolicy",
                this.childPolicy.constructor !== undefined
                    ? this.childPolicy.constructor.name
                    : null,
            ],
            ["allowList", this.allowList],
        ]);
    }

    /**
     * @internal
     * @ignore
     */
    getRustConfiguration(): _rust.LoadBalancingConfig {
        const options = this.childPolicy.getRustConfiguration();
        const childAllowList = options.allowList;
        if (childAllowList) {
            // In case some other policy provided allow list, we take an intersection
            // to mimic the original behavior of this policy
            options.allowList = this.allowList.filter(function (n) {
                return childAllowList.indexOf(n) !== -1;
            });
        } else {
            options.allowList = this.allowList;
        }
        return options;
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
    #client: any;
    #hosts: any;
    #filteredHosts: Array<Host> | null;
    #preferredHost: any;
    #index: number;
    #filter: (host: any) => boolean;

    /**
     * Creates a new instance of `LegacyDefaultLoadBalancingPolicy`.
     * @param options The local data center name or the optional policy options object.
     *
     * Note that when providing the local data center name, it overrides `localDataCenter` option at
     * `Client` level.
     * @param options.localDc local data center name.  This value overrides the 'localDataCenter' Client option
     * and is useful for cases where you have multiple execution profiles that you intend on using for routing
     * requests to different data centers.
     * @param options.filter A function to apply to determine if hosts are included in the query plan.
     * The function takes a Host parameter and returns a Boolean.
     */
    constructor(options?: string | LegacyDefaultLoadBalancingPolicyOptions) {
        super();

        let resolved: LegacyDefaultLoadBalancingPolicyOptions;
        if (typeof options === "string") {
            resolved = { localDc: options };
        } else if (!options) {
            resolved = utils.emptyObject;
        } else {
            resolved = options;
        }

        this.#client = null;
        this.#hosts = null;
        this.#filteredHosts = null;
        this.#preferredHost = null;
        this.#index = 0;
        this.localDc = resolved.localDc;
        this.#filter = resolved.filter || this.#defaultFilter;

        // Allow some checks to be injected
        if (resolved.isHostNewlyUp) {
            this.#isHostNewlyUp = resolved.isHostNewlyUp;
        }
        if (resolved.healthCheck) {
            this.#healthCheck = resolved.healthCheck;
        }
        if (resolved.compare) {
            this.#compare = resolved.compare;
        }
        if (resolved.getReplicas) {
            this.#getReplicas = resolved.getReplicas;
        }
    }

    /**
     * Initializes the load balancing policy, called after the driver obtained the information of the cluster.
     */
    init(client: Client, hosts: HostMap, callback: EmptyCallback): void {
        const done = callback as InitCallback;
        this.#client = client;
        this.#hosts = hosts;

        // Clean local host cache
        this.#hosts.on("add", () => (this.#filteredHosts = null));
        this.#hosts.on("remove", () => (this.#filteredHosts = null));

        try {
            setLocalDc(this, client, this.#hosts);
        } catch (err) {
            return done(err as Error);
        }

        done();
    }

    /**
     * Returns the distance assigned by this policy to the provided host, relatively to the client instance.
     */
    getDistance(host: Host): types.distance {
        if (this.#preferredHost !== null && host === this.#preferredHost) {
            // Set the last preferred host as local.
            // It ensures that the pool for the graph analytics host has the appropriate size
            return types.distance.local;
        }

        if (!this.#filter(host)) {
            return types.distance.ignored;
        }

        return host.datacenter === this.localDc
            ? types.distance.local
            : types.distance.ignored;
    }

    /**
     * Returns a host iterator to be used for a query execution.
     * @override
     */
    newQueryPlan(
        keyspace: string,
        executionOptions: ExecutionOptions | null,
        callback: QueryPlanCallback,
    ): void {
        let routingKey;
        let preferredHost;

        if (executionOptions) {
            routingKey = executionOptions.getRoutingKey();

            const executionKeyspace = executionOptions.getKeyspace();
            if (executionKeyspace) {
                keyspace = executionKeyspace;
            }

            preferredHost = executionOptions.getPreferredHost();
        }

        let iterable;

        if (!keyspace || !routingKey) {
            iterable = this.#getLocalHosts();
        } else {
            iterable = this.#getReplicasAndLocalHosts(keyspace, routingKey);
        }

        if (preferredHost) {
            // Set it on an instance level field to set the distance
            this.#preferredHost = preferredHost;
            iterable = LegacyDefaultLoadBalancingPolicy.#getPreferredHostFirst(
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
    static *#getPreferredHostFirst(
        preferredHost: any,
        iterable: Iterable<any>,
    ): Generator<any> {
        yield preferredHost;

        for (const host of iterable) {
            if (host !== preferredHost) {
                yield host;
            }
        }
    }

    /**
     * Yields the local hosts without the replicas already yielded
     * @param localReplicas The local replicas that we should avoid to include again
     * @private
     */
    *#getLocalHosts(localReplicas?: Array<Host>): Generator<Host> {
        // Use a local reference
        const hosts = this.#getFilteredLocalHosts();
        const initialIndex = this.#getIndex();

        // indexOf() over an Array is a O(n) operation but given that there should be 3 to 7 replicas,
        // it shouldn't be an expensive call. Additionally, this will only be executed when the local replicas
        // have been exhausted in a lazy manner.
        const canBeYield = localReplicas
            ? (h: Host) => localReplicas.indexOf(h) === -1
            : (h: Host) => true;

        for (let i = 0; i < hosts.length; i++) {
            const h = hosts[(i + initialIndex) % hosts.length];
            if (canBeYield(h) && h.isUp()) {
                yield h;
            }
        }
    }

    #getReplicasAndLocalHosts(
        keyspace: string,
        routingKey: any,
    ): Generator<Host> {
        let replicas = this.#getReplicas(keyspace, routingKey);
        if (replicas === null) {
            return this.#getLocalHosts();
        }

        const filteredReplicas: Array<Host> = [];
        let newlyUpReplica: Host | null = null;
        let newlyUpReplicaTimestamp = Number.MIN_SAFE_INTEGER;
        let unhealthyReplicas = 0;

        // Filter by DC, predicate and UP replicas
        // Use the same iteration to perform other checks: whether if its newly UP or unhealthy
        // As this is part of the hot path, we use a simple loop and avoid using Array.prototype.filter() + closure
        for (let i = 0; i < replicas.length; i++) {
            const h = replicas[i];
            if (
                !this.#filter(h) ||
                h.datacenter !== this.localDc ||
                !h.isUp()
            ) {
                continue;
            }
            const isUpSince = this.#isHostNewlyUp(h);
            if (isUpSince !== null && isUpSince > newlyUpReplicaTimestamp) {
                newlyUpReplica = h;
                newlyUpReplicaTimestamp = isUpSince;
            }
            if (newlyUpReplica === null && !this.#healthCheck(h)) {
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
                this.#sendUnhealthyToTheBack(replicas, unhealthyReplicas);
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

        if (this.#compare(replicas[1], replicas[0]) > 0) {
            // Power of two random choices
            temp = replicas[0];
            replicas[0] = replicas[1];
            replicas[1] = temp;
        }

        return this.yieldReplicasFirst(replicas);
    }

    /**
     * Yields the local replicas followed by the rest of local nodes.
     * @param replicas The local replicas
     */
    *yieldReplicasFirst(replicas: Array<Host>): Generator<Host> {
        for (let i = 0; i < replicas.length; i++) {
            yield replicas[i];
        }
        yield* this.#getLocalHosts(replicas);
    }

    #isHostNewlyUp = (h: any): number | null => {
        return h.isUpSince !== null &&
            Date.now() - h.isUpSince < newlyUpInterval
            ? h.isUpSince
            : null;
    };

    /**
     * Returns a boolean determining whether the host health is ok or not.
     * A Host is considered unhealthy when there are enough items in the queue (10 items in-flight) but the
     * Host is not responding to those requests.
     * @private
     */
    #healthCheck = (h: any): boolean => {
        return !(h.getInFlight() >= 10 && h.getResponseCount() <= 1);
    };

    /**
     * Compares to host and returns 1 if it needs to favor the first host otherwise, -1.
     * @private
     */
    #compare = (h1: any, h2: any): number => {
        return h1.getInFlight() < h2.getInFlight() ? 1 : -1;
    };

    #getReplicas = (keyspace: string, routingKey: any): Array<Host> | null => {
        return this.#client.getReplicas(keyspace, routingKey);
    };

    /**
     * Returns an Array of hosts filtered by DC and predicate.
     * @private
     */
    #getFilteredLocalHosts(): Array<Host> {
        let filteredHosts = this.#filteredHosts;
        if (filteredHosts === null) {
            filteredHosts = (this.#hosts.values() as Array<Host>).filter(
                (h: Host) => this.#filter(h) && h.datacenter === this.localDc,
            );
            this.#filteredHosts = filteredHosts;
        }
        return filteredHosts;
    }

    #getIndex(): number {
        const result = this.#index++;
        // Overflow protection
        if (this.#index === 0x7fffffff) {
            this.#index = 0;
        }
        return result;
    }

    #sendUnhealthyToTheBack(
        replicas: Array<Host>,
        unhealthyReplicas: number,
    ): void {
        let counter = 0;

        // Start from the back, move backwards and stop once all unhealthy replicas are at the back
        for (
            let i = replicas.length - 1;
            i >= 0 && counter < unhealthyReplicas;
            i--
        ) {
            const host = replicas[i];
            if (this.#healthCheck(host)) {
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

    #defaultFilter(): boolean {
        return true;
    }

    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map<string, any>([
            ["localDataCenter", this.localDc],
            ["filterFunction", this.#filter !== this.#defaultFilter],
        ]);
    }
}

/**
 * Validates and sets the local data center to be used.
 * @private
 */
function setLocalDc(
    lbp: LegacyDefaultLoadBalancingPolicy,
    client: any,
    hosts: HostMap,
): void {
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
    #config: LoadBalancingConfig;

    constructor(config?: LoadBalancingConfig) {
        super();
        if (!config) {
            config = new LoadBalancingConfig();
        }
        this.#config = config;
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        throwNotSupported("Not implemented.");
    }

    /**
     * @internal
     * @ignore
     */
    getRustConfiguration(): _rust.LoadBalancingConfig {
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
     */
    preferDatacenter?: string;
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
     */
    preferRack?: string;
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
     */
    tokenAware?: boolean;
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
     */
    permitDcFailover?: boolean;
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
     */
    enableShufflingReplicas?: boolean;

    /**
     * The hosts address in the format ipAddress:port.
     * When the list is provided, only hosts from this list may get connected to
     * (whether they will get connected to or not depends on the other policy options).
     *
     */
    allowList?: Array<string>;
}

function getDataCenters(hosts: HostMap): Set<string | null> {
    return new Set(hosts.values().map((h) => h.datacenter));
}

export {
    AllowListPolicy,
    DCAwareRoundRobinPolicy,
    LegacyDefaultLoadBalancingPolicy,
    LoadBalancingPolicy,
    RoundRobinPolicy,
    TokenAwarePolicy,
    LoadBalancingConfig,
    DefaultLoadBalancingPolicy,
};
