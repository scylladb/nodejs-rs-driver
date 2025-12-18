"use strict";

/**
 * Contains driver tuning policies to determine [load balancing]{@link module:policies/loadBalancing},
 *  [retrying]{@link module:policies/retry} queries, [reconnecting]{@link module:policies/reconnection} to a node,
 *  [address resolution]{@link module:policies/addressResolution},
 *  [timestamp generation]{@link module:policies/timestampGeneration} and
 *  [speculative execution]{@link module:policies/speculativeExecution}.
 * @module policies
 */
const addressResolution =
    (exports.addressResolution = require("./address-resolution"));
const loadBalancing = (exports.loadBalancing = require("./load-balancing"));
const reconnection = (exports.reconnection = require("./reconnection"));
const retry = (exports.retry = require("./retry"));
const speculativeExecution =
    (exports.speculativeExecution = require("./speculative-execution"));
const timestampGeneration =
    (exports.timestampGeneration = require("./timestamp-generation"));

/**
 * Returns a new instance of the default address translator policy used by the driver.
 * @returns {AddressTranslator}
 */
exports.defaultAddressTranslator = function () {
    return new addressResolution.AddressTranslator();
};

/**
 * Returns a new instance of the default load-balancing policy used by the driver.
 * @param {string} [localDc] When provided, it sets the data center that is going to be used as local for the
 * load-balancing policy instance.
 *
 * When localDc is undefined, the load-balancing policy instance will use the `localDataCenter`
 * provided in the {@link ClientOptions}.
 * @returns {LoadBalancingPolicy}
 */
exports.defaultLoadBalancingPolicy = function (localDc) {
    return new loadBalancing.LegacyDefaultLoadBalancingPolicy(localDc);
};

/**
 * Returns a new instance of the default retry policy used by the driver.
 * @returns {RetryPolicy}
 */
exports.defaultRetryPolicy = function () {
    return new retry.RetryPolicy();
};

/**
 * Returns a new instance of the default reconnection policy used by the driver.
 * @returns {ReconnectionPolicy}
 */
exports.defaultReconnectionPolicy = function () {
    return new reconnection.ExponentialReconnectionPolicy(
        1000,
        10 * 60 * 1000,
        false,
    );
};

/**
 * Returns a new instance of the default speculative execution policy used by the driver.
 * @returns {SpeculativeExecutionPolicy}
 */
exports.defaultSpeculativeExecutionPolicy = function () {
    return new speculativeExecution.NoSpeculativeExecutionPolicy();
};

/**
 * Returns a new instance of the default timestamp generator used by the driver.
 * @returns {TimestampGenerator}
 */
exports.defaultTimestampGenerator = function () {
    return new timestampGeneration.MonotonicTimestampGenerator();
};
