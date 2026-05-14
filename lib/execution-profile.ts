import types = require("./types");
import promiseUtils = require("./promise-utils");
import newUtils = require("./new-utils");
import type { loadBalancing, retry } from "./policies";
import type { Client, ClientOptions, EmptyCallback, Host, HostMap } from "../";

type LoadBalancingPolicy = loadBalancing.LoadBalancingPolicy;
type RetryPolicy = retry.RetryPolicy;

/**
 * Represents a set configurations to be used in a statement execution to be used for a single {@link Client} instance.
 *
 * An {@link ExecutionProfile} instance should not be shared across different {@link Client} instances.
 * @example
 * const { Client, ExecutionProfile } = require('cassandra-driver');
 * const client = new Client({
 *   contactPoints: ['host1', 'host2'],
 *   profiles: [
 *     new ExecutionProfile('metrics-oltp', {
 *       consistency: consistency.localQuorum,
 *       retry: myRetryPolicy
 *     })
 *   ]
 * });
 *
 * client.execute(query, params, { executionProfile: 'metrics-oltp' }, callback);
 */
class ExecutionProfile {
    /** Name of the execution profile. */
    name: string;
    /** Consistency level. */
    consistency?: types.consistencies;
    /** Load-balancing policy. */
    loadBalancing?: LoadBalancingPolicy;
    /** Client read timeout. */
    readTimeout?: number;
    /** Retry policy. */
    retry?: RetryPolicy;
    /** Serial consistency level. */
    serialConsistency?: types.consistencies;

    /**
     * @param name Name of the execution profile.
     * Use `'default'` to specify that the new instance should be the default {@link ExecutionProfile} if no
     * profile is specified in the execution.
     * @param options Profile options, when any of the options is not specified the {@link Client} will the use
     * the ones defined in the default profile. See {@link ClientOptions} for more details.
     */
    constructor(name: string, options?: {
        consistency?: types.consistencies;
        loadBalancing?: LoadBalancingPolicy;
        readTimeout?: number;
        retry?: RetryPolicy;
        serialConsistency?: types.consistencies;
    }) {
        // Legacy check. Old code had this check, and using TS does not prevent JS user from providing wrong type
        if (typeof name !== "string") {
            throw new TypeError("Execution profile name must be a string");
        }
        const opts = options || {} as NonNullable<typeof options>;
        this.name = name;
        this.consistency = opts.consistency;
        this.loadBalancing = opts.loadBalancing;
        this.readTimeout = opts.readTimeout;
        this.retry = opts.retry;
        this.serialConsistency = opts.serialConsistency;

        // @ts-ignore - This is an explicit check for the use of deprecated option
        if (opts.graphOptions !== undefined) {
            // This option was present in the DSx driver, but is no longer relevant.
            // We explicitly check for it to inform users using this options,
            // to avoid any confusion if the user code depends on this configuration.
            newUtils.throwNotSupported("Graph options");
        }
    }
}

/**
 * Contains the logic to handle the different execution profiles of a {@link Client}.
 * @ignore
 */
class ProfileManager {
    _profiles: ExecutionProfile[];
    _defaultConfiguredRetryPolicy: RetryPolicy | undefined;
    _defaultProfile!: ExecutionProfile;
    /** A array of unique load balancing policies */
    _loadBalancingPolicies: LoadBalancingPolicy[];
    /** A dictionary of name keys and profile values */
    _profilesMap: Record<string, ExecutionProfile>;
    /** A dictionary of name keys and custom payload dictionaries as values */
    _customPayloadCache: Record<string, never>;

    constructor(options: ClientOptions) {
        this._profiles = options.profiles || [];
        this._defaultConfiguredRetryPolicy = undefined;
        this._setDefault(options);
        this._loadBalancingPolicies = [];
        this._profilesMap = {};
        this._customPayloadCache = {};
        this._profiles.forEach((p) => {
            this._profilesMap[p.name] = p;
            // Set required properties
            p.loadBalancing =
                p.loadBalancing || this._defaultProfile.loadBalancing;
            // Using array indexOf is not very efficient (O(n)) but the amount of profiles should be limited
            // and a handful of load-balancing policies (no hashcode for load-Balancing policies)
            if (this._loadBalancingPolicies.indexOf(p.loadBalancing!) === -1) {
                this._loadBalancingPolicies.push(p.loadBalancing!);
            }
        });
    }

    async init(client: Client, hosts: HostMap): Promise<void> {
        for (const lbp of this._loadBalancingPolicies) {
            await promiseUtils.fromCallback((callback: EmptyCallback) =>
                lbp.init(client, hosts, callback),
            );
        }
    }

    /**
     * Uses the load-balancing policies to get the relative distance to the host and return the closest one.
     */
    getDistance(host: Host & { setDistance(d: types.distance): void }): types.distance {
        let distance: types.distance = types.distance.ignored;
        // this is performance critical: we can't use any other language features than for-loop :(
        for (let i = 0; i < this._loadBalancingPolicies.length; i++) {
            const d = this._loadBalancingPolicies[i].getDistance(host);
            if (d < distance) {
                distance = d;
                if (distance === types.distance.local) {
                    break;
                }
            }
        }

        host.setDistance(distance);
        return distance;
    }

    /**
     * Returns the execution profile by name or the default profile when name is
     * undefined. Returns undefined when the profile does not exist.
     */
    getProfile(name?: string | ExecutionProfile): ExecutionProfile | undefined {
        if (name instanceof ExecutionProfile) {
            return name;
        }
        return this._profilesMap[name || "default"];
    }

    getDefault(): ExecutionProfile {
        return this._defaultProfile;
    }

    getDefaultLoadBalancing(): LoadBalancingPolicy | undefined {
        return this._defaultProfile.loadBalancing;
    }

    private _setDefault(options: ClientOptions): void {
        this._defaultProfile = this._profiles.filter(function (p) {
            return p.name === "default";
        })[0];
        if (!this._defaultProfile) {
            this._profiles.push(
                (this._defaultProfile = new ExecutionProfile("default")),
            );
        }

        // Store the default configured retry policy
        this._defaultConfiguredRetryPolicy = this._defaultProfile.retry;

        // Set the required properties
        this._defaultProfile.loadBalancing =
            this._defaultProfile.loadBalancing ||
            options.policies?.loadBalancing;
        this._defaultProfile.retry =
            this._defaultProfile.retry || options.policies?.retry;
    }

    /**
     * Gets all the execution profiles currently defined.
     */
    getAll(): ExecutionProfile[] {
        return this._profiles;
    }

    getDefaultConfiguredRetryPolicy(): RetryPolicy | undefined {
        return this._defaultConfiguredRetryPolicy;
    }
}

export = {
    ProfileManager,
    ExecutionProfile,
};
