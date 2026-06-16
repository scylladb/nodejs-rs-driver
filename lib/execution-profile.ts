import types = require("./types");
import promiseUtils = require("./promise-utils");
import newUtils = require("./new-utils");
import type { loadBalancing, retry } from "./policies";
import type { Client, EmptyCallback, HostMap } from "../";
import type { ClientOptions } from "./client-options";

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
    constructor(
        name: string,
        options?: {
            consistency?: types.consistencies;
            loadBalancing?: LoadBalancingPolicy;
            readTimeout?: number;
            retry?: RetryPolicy;
            serialConsistency?: types.consistencies;
        },
    ) {
        // Legacy check. Old code had this check, and using TS does not prevent JS user from providing wrong type
        if (typeof name !== "string") {
            throw new TypeError("Execution profile name must be a string");
        }
        const opts = options || ({} as NonNullable<typeof options>);
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
    #profiles: ExecutionProfile[];
    #defaultConfiguredRetryPolicy: RetryPolicy | undefined;
    #defaultProfile: ExecutionProfile;
    /** A array of unique load balancing policies */
    #loadBalancingPolicies: LoadBalancingPolicy[];
    /** A dictionary of name keys and profile values */
    #profilesMap: Record<string, ExecutionProfile>;

    constructor(options: ClientOptions) {
        this.#profiles = options.profiles || [];
        this.#defaultConfiguredRetryPolicy = undefined;
        this.#defaultProfile = this.#setAndGetDefault(options);
        this.#loadBalancingPolicies = [];
        this.#profilesMap = {};
        this.#profiles.forEach((p) => {
            this.#profilesMap[p.name] = p;
            // Set required properties
            p.loadBalancing =
                p.loadBalancing || this.#defaultProfile.loadBalancing;
            // Using array indexOf is not very efficient (O(n)) but the amount of profiles should be limited
            // and a handful of load-balancing policies (no hashcode for load-Balancing policies)
            if (this.#loadBalancingPolicies.indexOf(p.loadBalancing!) === -1) {
                this.#loadBalancingPolicies.push(p.loadBalancing!);
            }
        });
    }

    async init(client: Client, hosts: HostMap): Promise<void> {
        for (const lbp of this.#loadBalancingPolicies) {
            await promiseUtils.fromCallback((callback: EmptyCallback) =>
                lbp.init(client, hosts, callback),
            );
        }
    }

    /**
     * Returns the execution profile by name or the default profile when name is
     * undefined. Returns undefined when the profile does not exist.
     */
    getProfile(name?: string | ExecutionProfile): ExecutionProfile | undefined {
        if (name instanceof ExecutionProfile) {
            return name;
        }
        return this.#profilesMap[name || "default"];
    }

    getDefault(): ExecutionProfile {
        return this.#defaultProfile;
    }

    getDefaultLoadBalancing(): LoadBalancingPolicy | undefined {
        return this.#defaultProfile.loadBalancing;
    }

    #setAndGetDefault(options: ClientOptions): ExecutionProfile {
        let defaultProfile = this.#profiles.filter(function (p) {
            return p.name === "default";
        })[0];
        if (!defaultProfile) {
            this.#profiles.push(
                (defaultProfile = new ExecutionProfile("default")),
            );
        }

        // Store the default configured retry policy
        this.#defaultConfiguredRetryPolicy = defaultProfile.retry;

        // Set the required properties
        defaultProfile.loadBalancing =
            defaultProfile.loadBalancing || options.policies?.loadBalancing;
        defaultProfile.retry = defaultProfile.retry || options.policies?.retry;

        return defaultProfile;
    }

    /**
     * Gets all the execution profiles currently defined.
     */
    getAll(): ExecutionProfile[] {
        return this.#profiles;
    }

    getDefaultConfiguredRetryPolicy(): RetryPolicy | undefined {
        return this.#defaultConfiguredRetryPolicy;
    }
}

export = {
    ProfileManager,
    ExecutionProfile,
};
