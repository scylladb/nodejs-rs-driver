// @ts-nocheck
"use strict";

const utils = require("./utils");
const types = require("./types");
const errors = require("./errors");
const _rust = require("../index");
const { queryOptionsIntoWrapper } = require("./query-options");

const proxyExecuteKey = "ProxyExecute";

/**
 * A base class that represents a wrapper around the user provided query options with getter methods and proper
 * default values.
 *
 * Note that getter methods might return `undefined` when not set on the query options or default
 * {@link Client} options.
 */
class ExecutionOptions {
    /**
     * @type {_rust.QueryOptionsWrapper?}
     */
    #rustWrapper;

    /**
     * Creates a new instance of {@link ExecutionOptions}.
     */
    constructor() {}

    /**
     * Creates rust options wrapper for this execution options unless it already exists.
     * Goal of this function is to avoid wrapping the same options multiple times.
     * @internal
     * @ignore
     */
    wrapOptionsIfNotWrappedYet() {
        if (!this.#rustWrapper) {
            this.#rustWrapper = queryOptionsIntoWrapper(this);
        }
    }

    /**
     * Get this options as rust wrapper.
     * @returns {_rust.QueryOptionsWrapper}
     * @internal
     * @ignore
     */
    getRustOptions() {
        this.wrapOptionsIfNotWrappedYet();
        return this.#rustWrapper;
    }

    /**
     * Creates an empty instance, where all methods return undefined, used internally.
     * @ignore
     * @return {ExecutionOptions}
     */
    static empty() {
        return new ExecutionOptions();
    }

    /**
     * Determines if the stack trace before the query execution should be maintained.
     * @abstract
     * @returns {Boolean}
     */
    getCaptureStackTrace() {}

    /**
     * Gets the [Consistency level]{@link module:types~consistencies} to be used for the execution.
     * @abstract
     * @returns {Number}
     */
    getConsistency() {}

    /**
     * Key-value payload to be passed to the server. On the server side, implementations of QueryHandler can use
     * this data.
     * @abstract
     * @returns {Object}
     */
    getCustomPayload() {}

    /**
     * Gets the amount of rows to retrieve per page.
     * @abstract
     * @returns {Number}
     */
    getFetchSize() {}

    /**
     * When a fixed host is set on the query options and the query plan for the load-balancing policy is not used, it
     * gets the host that should handle the query.
     * @returns {Host}
     */
    getFixedHost() {}

    /**
     * Gets the type hints for parameters given in the query, ordered as for the parameters.
     * @abstract
     * @returns {Array<ColumnInfo>|Array<Array<ColumnInfo>>|undefined}
     */
    getHints() {}

    /**
     * Determines whether the driver must retrieve the following result pages automatically.
     *
     * This setting is only considered by the [Client#eachRow()]{@link Client#eachRow} method.
     * @abstract
     * @returns {Boolean}
     */
    isAutoPage() {}

    /**
     * Determines whether its a counter batch. Only valid for [Client#batch()]{@link Client#batch}, it will be ignored by
     * other methods.
     * @abstract
     * @returns {Boolean} A `Boolean` value, it can't be `undefined`.
     */
    isBatchCounter() {}

    /**
     * Determines whether the batch should be written to the batchlog. Only valid for
     * [Client#batch()]{@link Client#batch}, it will be ignored by other methods.
     * @abstract
     * @returns {Boolean} A `Boolean` value, it can't be `undefined`.
     */
    isBatchLogged() {}

    /**
     * Determines whether the query can be applied multiple times without changing the result beyond the initial
     * application.
     * @abstract
     * @returns {Boolean}
     */
    isIdempotent() {}

    /**
     * Determines whether the query must be prepared beforehand.
     * @abstract
     * @returns {Boolean} A `Boolean` value, it can't be `undefined`.
     */
    isPrepared() {}

    /**
     * Determines whether query tracing is enabled for the execution.
     * @abstract
     * @returns {Boolean}
     */
    isQueryTracing() {}

    /**
     * Gets the keyspace for the query when set at query options level.
     *
     * Note that this method will return `undefined` when the keyspace is not set at query options level.
     * It will only return the keyspace name when the user provided a different keyspace than the current
     * {@link Client} keyspace.
     * @abstract
     * @returns {String}
     */
    getKeyspace() {}

    /**
     * Gets the load balancing policy used for this execution.
     * @returns {LoadBalancingPolicy} A `LoadBalancingPolicy` instance, it can't be `undefined`.
     */
    getLoadBalancingPolicy() {}

    /**
     * Determines if the query should be paged.
     * @abstract
     * @returns {boolean}
     */
    isPaged() {}

    /**
     * Gets the Buffer representing the paging state.
     * @abstract
     * @returns {Buffer}
     */
    getPageState() {}

    /**
     * Internal method that gets the preferred host.
     * @abstract
     * @ignore
     */
    getPreferredHost() {}

    /**
     * Gets the query options as provided to the execution method without setting the default values.
     * @returns {QueryOptions}
     */
    getRawQueryOptions() {}

    /**
     * Gets the timeout in milliseconds to be used for the execution per coordinator.
     *
     * A value of `0` disables client side read timeout for the execution. Default: `undefined`.
     * @abstract
     * @returns {Number}
     */
    getReadTimeout() {}

    /**
     * Gets the [retry policy]{@link module:policies/retry} to be used.
     * @abstract
     * @returns {RetryPolicy} A `RetryPolicy` instance, it can't be `undefined`.
     */
    getRetryPolicy() {}

    /**
     * Internal method to obtain the row callback, for "by row" results.
     * @abstract
     * @ignore
     */
    getRowCallback() {}

    /**
     * Internal method to get or generate a timestamp for the request execution.
     * @ignore
     * @returns {Long|null}
     */
    getOrGenerateTimestamp() {}

    /**
     * Gets the index of the parameters that are part of the partition key to determine the routing.
     * @abstract
     * @ignore
     * @returns {Array<any>}
     */
    getRoutingIndexes() {}

    /**
     * Gets the partition key(s) to determine which coordinator should be used for the query.
     * @abstract
     * @returns {Buffer|Array<Buffer>}
     */
    getRoutingKey() {}

    /**
     * Gets the array of the parameters names that are part of the partition key to determine the
     * routing. Only valid for non-prepared requests.
     * @abstract
     * @ignore
     */
    getRoutingNames() {}

    /**
     * Gets the the consistency level to be used for the serial phase of conditional updates.
     * @abstract
     * @returns {Number}
     */
    getSerialConsistency() {}

    /**
     * Gets the provided timestamp for the execution in microseconds from the unix epoch (00:00:00, January 1st, 1970).
     *
     * When a timestamp generator is used, this method returns `undefined`.
     * @abstract
     * @returns {Number|Long|undefined|null}
     */
    getTimestamp() {}

    /**
     * @param {Array<any>} hints
     * @abstract
     * @ignore
     */
    setHints(hints) {}

    /**
     * Sets the keyspace for the execution.
     * @ignore
     * @abstract
     * @param {String} keyspace
     */
    setKeyspace(keyspace) {}

    /**
     * @abstract
     * @ignore
     */
    setPageState() {}

    /**
     * Internal method that sets the preferred host.
     * @abstract
     * @ignore
     */
    setPreferredHost() {}

    /**
     * Sets the index of the parameters that are part of the partition key to determine the routing.
     * @param {Array<any>} routingIndexes
     * @abstract
     * @ignore
     */
    setRoutingIndexes(routingIndexes) {}

    /**
     * Sets the routing key.
     * @abstract
     * @ignore
     */
    setRoutingKey(value) {}
}

/**
 * Internal implementation of {@link ExecutionOptions} that uses the value from the client options and execution
 * profile into account.
 * @ignore
 */
class DefaultExecutionOptions extends ExecutionOptions {
    #queryOptions;
    #rowCallback;
    #routingKey;
    #hints;
    #keyspace;
    #routingIndexes;
    #pageState;
    #client;
    #defaultQueryOptions;
    #profile;
    #customPayload;

    /**
     * Creates a new instance of {@link ExecutionOptions}.
     * @param {QueryOptions} queryOptions
     * @param {Client} client
     * @param {Function|null} rowCallback
     */
    constructor(queryOptions, client, rowCallback) {
        super();

        this.#queryOptions = queryOptions;
        this.#rowCallback = rowCallback;
        this.#routingKey = this.#queryOptions.routingKey;
        this.#hints = this.#queryOptions.hints;
        this.#keyspace = this.#queryOptions.keyspace;
        this.#routingIndexes = this.#queryOptions.routingIndexes;
        this.#pageState =
            typeof this.#queryOptions.pageState === "string"
                ? utils.allocBufferFromString(
                      this.#queryOptions.pageState,
                      "hex",
                  )
                : this.#queryOptions.pageState;

        this.#client = client;
        this.#defaultQueryOptions = client.options.queryOptions;
        this.#profile = client.profileManager.getProfile(
            this.#queryOptions.executionProfile,
        );

        // Build a custom payload object designed for DSE-specific functionality
        this.#customPayload = DefaultExecutionOptions.createCustomPayload(
            this.#queryOptions,
            this.#defaultQueryOptions,
        );

        if (!this.#profile) {
            throw new errors.ArgumentError(
                `Execution profile "${this.#queryOptions.executionProfile}" not found`,
            );
        }
    }

    /**
     * Creates a payload for given user.
     * @param {QueryOptions} userOptions
     * @param {QueryOptions} defaultQueryOptions
     * @private
     */
    static createCustomPayload(userOptions, defaultQueryOptions) {
        let customPayload =
            userOptions.customPayload || defaultQueryOptions.customPayload;
        const executeAs =
            userOptions.executeAs || defaultQueryOptions.executeAs;

        if (executeAs) {
            if (!customPayload) {
                customPayload = {};
                customPayload[proxyExecuteKey] =
                    utils.allocBufferFromString(executeAs);
            } else if (!customPayload[proxyExecuteKey]) {
                // Avoid appending to the existing payload object
                customPayload = utils.extend({}, customPayload);
                customPayload[proxyExecuteKey] =
                    utils.allocBufferFromString(executeAs);
            }
        }

        return customPayload;
    }

    /**
     * Creates a new instance {@link ExecutionOptions}, based on the query options.
     * @param {QueryOptions|null} queryOptions
     * @param {Client} client
     * @param {Function|null} [rowCallback]
     * @ignore
     * @return {ExecutionOptions}
     */
    static create(queryOptions, client, rowCallback) {
        if (!queryOptions || typeof queryOptions === "function") {
            // queryOptions can be null/undefined and could be of type function when is an optional parameter
            queryOptions = utils.emptyObject;
        }
        return new DefaultExecutionOptions(queryOptions, client, rowCallback);
    }

    getCaptureStackTrace() {
        return ifUndefined(
            this.#queryOptions.captureStackTrace,
            this.#defaultQueryOptions.captureStackTrace,
        );
    }

    getConsistency() {
        return ifUndefined3(
            this.#queryOptions.consistency,
            this.#profile.consistency,
            this.#defaultQueryOptions.consistency,
        );
    }

    getCustomPayload() {
        return this.#customPayload;
    }

    getFetchSize() {
        return ifUndefined(
            this.#queryOptions.fetchSize,
            this.#defaultQueryOptions.fetchSize,
        );
    }

    getFixedHost() {
        return this.#queryOptions.host;
    }

    getHints() {
        return this.#hints;
    }

    isAutoPage() {
        return ifUndefined(
            this.#queryOptions.autoPage,
            this.#defaultQueryOptions.autoPage,
        );
    }

    isBatchCounter() {
        return ifUndefined(this.#queryOptions.counter, false);
    }

    isBatchLogged() {
        return ifUndefined3(
            this.#queryOptions.logged,
            this.#defaultQueryOptions.logged,
            true,
        );
    }

    isIdempotent() {
        return ifUndefined(
            this.#queryOptions.isIdempotent,
            this.#defaultQueryOptions.isIdempotent,
        );
    }

    /**
     * Determines if the query execution must be prepared beforehand.
     * @return {Boolean}
     */
    isPrepared() {
        return ifUndefined(
            this.#queryOptions.prepare,
            this.#defaultQueryOptions.prepare,
        );
    }

    isQueryTracing() {
        return ifUndefined(
            this.#queryOptions.traceQuery,
            this.#defaultQueryOptions.traceQuery,
        );
    }

    getKeyspace() {
        return this.#keyspace;
    }

    getLoadBalancingPolicy() {
        return this.#profile.loadBalancing;
    }

    getOrGenerateTimestamp() {
        let result = this.getTimestamp();

        if (result === undefined) {
            const generator = this.#client.options.policies.timestampGeneration;

            if (
                types.protocolVersion.supportsTimestamp(
                    this.#client.controlConnection.protocolVersion,
                ) &&
                generator
            ) {
                result = generator.next(this.#client);
            } else {
                result = null;
            }
        }

        return typeof result === "number"
            ? types.Long.fromNumber(result)
            : result;
    }

    isPaged() {
        return ifUndefined(
            this.#queryOptions.paged,
            this.#defaultQueryOptions.paged,
        );
    }

    getPageState() {
        return this.#pageState;
    }

    /**
     * Gets the profile defined by the user or the default profile
     * @internal
     * @ignore
     */
    getProfile() {
        return this.#profile;
    }

    getRawQueryOptions() {
        return this.#queryOptions;
    }

    getReadTimeout() {
        return ifUndefined3(
            this.#queryOptions.readTimeout,
            this.#profile.readTimeout,
            this.#client.options.socketOptions.readTimeout,
        );
    }

    getRetryPolicy() {
        return ifUndefined3(
            this.#queryOptions.retry,
            this.#profile.retry,
            this.#client.options.policies.retry,
        );
    }

    getRoutingIndexes() {
        return this.#routingIndexes;
    }

    getRoutingKey() {
        return this.#routingKey;
    }

    getRoutingNames() {
        return this.#queryOptions.routingNames;
    }

    /**
     * Internal method to obtain the row callback, for "by row" results.
     * @ignore
     */
    getRowCallback() {
        return this.#rowCallback;
    }

    getSerialConsistency() {
        return ifUndefined3(
            this.#queryOptions.serialConsistency,
            this.#profile.serialConsistency,
            this.#defaultQueryOptions.serialConsistency,
        );
    }

    getTimestamp() {
        return this.#queryOptions.timestamp;
    }

    /**
     * Internal property to set the custom payload.
     * @ignore
     * @internal
     * @param {Object} payload
     */
    setCustomPayload(payload) {
        this.#customPayload = payload;
    }

    /**
     * @param {Array<any>} hints
     */
    setHints(hints) {
        this.#hints = hints;
    }

    /**
     * @param {String} keyspace
     */
    setKeyspace(keyspace) {
        this.#keyspace = keyspace;
    }

    /**
     * @param {Buffer} pageState
     */
    setPageState(pageState) {
        this.#pageState = pageState;
    }

    /**
     * @param {Array<any>} routingIndexes
     */
    setRoutingIndexes(routingIndexes) {
        this.#routingIndexes = routingIndexes;
    }

    setRoutingKey(value) {
        this.#routingKey = value;
    }
}

function ifUndefined(v1, v2) {
    return v1 !== undefined ? v1 : v2;
}

function ifUndefined3(v1, v2, v3) {
    if (v1 !== undefined) {
        return v1;
    }
    return v2 !== undefined ? v2 : v3;
}

module.exports = { ExecutionOptions, DefaultExecutionOptions, proxyExecuteKey };
