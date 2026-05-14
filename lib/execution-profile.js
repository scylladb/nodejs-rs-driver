// @ts-nocheck
"use strict";

const utils = require("./utils");
const types = require("./types");
const promiseUtils = require("./promise-utils");
const { throwNotSupported } = require("./new-utils");

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
    /**
     * @param {String} name Name of the execution profile.
     * Use `'default'` to specify that the new instance should be the default {@link ExecutionProfile} if no
     * profile is specified in the execution.
     * @param {Object} [options] Profile options, when any of the options is not specified the {@link Client} will the use
     * the ones defined in the default profile. See {@link ClientOptions} for more details.
     * @param {Number} [options.consistency] The consistency level to use for this profile.
     * @param {LoadBalancingPolicy} [options.loadBalancing] The load-balancing policy to use for this profile.
     * @param {Number} [options.readTimeout] The client per-host request timeout to use for this profile.
     * @param {RetryPolicy} [options.retry] The retry policy to use for this profile.
     * @param {Number} [options.serialConsistency] The serial consistency level to use for this profile.
     */
    constructor(name, options) {
        if (typeof name !== "string") {
            throw new TypeError("Execution profile name must be a string");
        }
        options = options || utils.emptyObject;
        /**
         * Name of the execution profile.
         * @type {String}
         */
        this.name = name;
        /**
         * Consistency level.
         * @type {Number | undefined}
         */
        this.consistency = options.consistency;
        /**
         * Load-balancing policy
         * @type {LoadBalancingPolicy}
         */
        this.loadBalancing = options.loadBalancing;
        /**
         * Client read timeout.
         * @type {Number| undefined}
         */
        this.readTimeout = options.readTimeout;
        /**
         * Retry policy.
         * @type {RetryPolicy}
         */
        this.retry = options.retry;
        /**
         * Serial consistency level.
         * @type {Number | undefined}
         */
        this.serialConsistency = options.serialConsistency;

        // @ts-ignore - This is an explicit check for the use of deprecated option
        if (options.graphOptions !== undefined) {
            // This option was present in the DSx driver, but is no longer relevant.
            // We explicitly check for it to inform users using this options,
            // to avoid any confusion if the user code depends on this configuration.
            throwNotSupported("Graph options");
        }
    }
}

/**
 * Contains the logic to handle the different execution profiles of a {@link Client}.
 * @ignore
 */
class ProfileManager {
    /**
     * @param {ClientOptions} options
     */
    constructor(options) {
        this._profiles = options.profiles || [];
        this._defaultConfiguredRetryPolicy = undefined;
        this._setDefault(options);
        // A array of unique load balancing policies
        /**
         * @type {any[]}
         */
        this._loadBalancingPolicies = [];
        // A dictionary of name keys and profile values
        /**
         * @type {Record<string | number, any>}
         */
        this._profilesMap = {};
        // A dictionary of name keys and custom payload dictionaries as values
        this._customPayloadCache = {};
        this._profiles.forEach( (/** @type {{ name: string | number; loadBalancing: any; }} */ p) => {
            this._profilesMap[p.name] = p;
            // Set required properties
            p.loadBalancing =
                p.loadBalancing || this._defaultProfile.loadBalancing;
            // Using array indexOf is not very efficient (O(n)) but the amount of profiles should be limited
            // and a handful of load-balancing policies (no hashcode for load-Balancing policies)
            if (this._loadBalancingPolicies.indexOf(p.loadBalancing) === -1) {
                this._loadBalancingPolicies.push(p.loadBalancing);
            }
        });
    }

    /**
     * @param {Client} client
     * @param {HostMap} hosts
     */
    async init(client, hosts) {
        for (const lbp of this._loadBalancingPolicies) {
            await promiseUtils.fromCallback((/** @type {any} */ callback) =>
                lbp.init(client, hosts, callback),
            );
        }
    }

    /**
     * Uses the load-balancing policies to get the relative distance to the host and return the closest one.
     * @param {Host} host
     */
    getDistance(host) {
        let distance = types.distance.ignored;
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
     * @param {String|ExecutionProfile} [name]
     * @returns {ExecutionProfile|undefined} It returns the execution profile by name or the default profile when name is
     * undefined. It returns undefined when the profile does not exist.
     */
    getProfile(name) {
        if (name instanceof ExecutionProfile) {
            return name;
        }
        return this._profilesMap[name || "default"];
    }

    /** @returns {ExecutionProfile} */
    getDefault() {
        return this._defaultProfile;
    }

    /** @returns {LoadBalancingPolicy} */
    getDefaultLoadBalancing() {
        return this._defaultProfile.loadBalancing;
    }

    /**
     * @private
     * @param {ClientOptions} options
     */
    _setDefault(options) {
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
            options.policies.loadBalancing;
        this._defaultProfile.retry =
            this._defaultProfile.retry || options.policies.retry;
    }

    /**
     * Gets all the execution profiles currently defined.
     * @returns {Array.<ExecutionProfile>}
     */
    getAll() {
        return this._profiles;
    }

    getDefaultConfiguredRetryPolicy() {
        return this._defaultConfiguredRetryPolicy;
    }
}

module.exports = {
    ProfileManager,
    ExecutionProfile,
};
