"use strict";

/**
 * Contains driver tuning policies to determine [load balancing]{@link module:policies/loadBalancing},
 *  [retrying]{@link module:policies/retry} queries, [reconnecting]{@link module:policies/reconnection} to a node,
 *  [address resolution]{@link module:policies/addressResolution},
 *  [timestamp generation]{@link module:policies/timestampGeneration} and
 *  [speculative execution]{@link module:policies/speculativeExecution}.
 * @module policies
 */
import addressResolution = require("./address-resolution");
import loadBalancing = require("./load-balancing");
import reconnection = require("./reconnection");
import retry = require("./retry");
import speculativeExecution = require("./speculative-execution");
import timestampGeneration = require("./timestamp-generation");

export {
    addressResolution,
    loadBalancing,
    reconnection,
    retry,
    speculativeExecution,
    timestampGeneration,
};

/**
 * Returns a new instance of the default address translator policy used by the driver.
 */
export function defaultAddressTranslator(): addressResolution.AddressTranslator {
    return new addressResolution.AddressTranslator();
}

/**
 * Returns a new instance of the default load-balancing policy used by the driver.
 * @param localDc When provided, it sets the data center that is going to be used as local for the
 * load-balancing policy instance, with dc failover disabled.
 *
 * When localDc is undefined, the load balancing policy will not be data-center aware.
 */
export function defaultLoadBalancingPolicy(
    localDc?: string,
): loadBalancing.DefaultLoadBalancingPolicy {
    if (!localDc) {
        return new loadBalancing.DefaultLoadBalancingPolicy();
    }

    return new loadBalancing.DefaultLoadBalancingPolicy({
        localDc: localDc,
        permitDcFailover: false,
    } as loadBalancing.LoadBalancingConfig);
}

/**
 * Returns a new instance of the default retry policy used by the driver.
 */
export function defaultRetryPolicy(): retry.RetryPolicy {
    return new retry.RetryPolicy();
}

/**
 * Returns a new instance of the default reconnection policy used by the driver.
 */
export function defaultReconnectionPolicy(): reconnection.ReconnectionPolicy {
    return new reconnection.ExponentialReconnectionPolicy(
        1000,
        10 * 60 * 1000,
        false,
    );
}

/**
 * Returns a new instance of the default speculative execution policy used by the driver.
 */
export function defaultSpeculativeExecutionPolicy(): speculativeExecution.SpeculativeExecutionPolicy {
    return new speculativeExecution.NoSpeculativeExecutionPolicy();
}

/**
 * Returns a new instance of the default timestamp generator used by the driver.
 */
export function defaultTimestampGenerator(): timestampGeneration.TimestampGenerator {
    return new timestampGeneration.MonotonicTimestampGenerator();
}
