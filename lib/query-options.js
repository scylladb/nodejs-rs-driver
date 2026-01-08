const Long = require("long");
const _execOptions = require("./execution-options");
const rust = require("../index");

/**
 * Query options
 * @typedef {Object} QueryOptions
 * @property {boolean} [autoPage] Determines if the driver must retrieve the following result pages automatically.
 *
 * This setting is only considered by the [Client#eachRow()]{@link Client#eachRow} method. For more information,
 * check the
 * [paging results documentation]{@link https://docs.datastax.com/en/developer/nodejs-driver/latest/features/paging/}.
 * @property {boolean} [captureStackTrace] Determines if the stack trace before the query execution should be
 * maintained.
 *
 * Useful for debugging purposes, it should be set to `false` under production environment as it adds an
 * unnecessary overhead to each execution.
 *
 * Default: false.
 * [TODO: Add support for this field]
 * @property {number} [consistency] [Consistency level]{@link module:types~consistencies}.
 *
 * Defaults to `localOne` for Apache Cassandra and ScyllaDB deployments.
 *
 * [TODO: Test this field]
 * @property {Object} [customPayload] Key-value payload to be passed to the server. On the Cassandra side,
 * implementations of QueryHandler can use this data.
 * [TODO: Add support for this field]
 * @property {string|ExecutionProfile} [executionProfile] Name or instance of the [profile]{@link ExecutionProfile} to
 * be used for this execution. If not set, it will the use "default" execution profile.
 * [TODO: Add support for this field]
 * @property {number} [fetchSize] Amount of rows to retrieve per page. Only valid if query is paged.
 * @property {Array|Array<Array>} [hints] Type hints for parameters given in the query, ordered as for the parameters.
 *
 * For batch queries, an array of such arrays, ordered as with the queries in the batch.
 * @property {Host} [host] The host that should handle the query.
 *
 * Use of this option is **heavily discouraged** and should only be used in the following cases:
 *
 * 1. Querying node-local tables, such as tables in the `system` and `system_views` keyspaces.
 * 2. Applying a series of schema changes, where it may be advantageous to execute schema changes in sequence on the
 *    same node.
 *
 * Configuring a specific host causes the configured
 * [LoadBalancingPolicy]{@link module:policies/loadBalancing~LoadBalancingPolicy} to be completely bypassed.
 * However, if the load balancing policy dictates that the host is at a
 * [distance of ignored]{@link module:types~distance} or there is no active connectivity to the host, the request will
 * fail with a [NoHostAvailableError]{@link module:errors~NoHostAvailableError}.
 * @property {boolean} [idempotent] Defines whether the query can be applied multiple times without changing the result
 * beyond the initial application.
 *
 * The query execution idempotence can be used at [RetryPolicy]{@link module:policies/retry~RetryPolicy} level to
 * determine if an statement can be retried in case of request error or write timeout.
 *
 * Default: `false`.
 *
 * [TODO: Add support for this field]
 * @property {string} [keyspace] Specifies the keyspace for the query. It is used for the following:
 *
 * 1. To indicate what keyspace the statement is applicable to (protocol V5+ only).  This is useful when the
 * query does not provide an explicit keyspace and you want to override the current {@link Client#keyspace}.
 * 2. For query routing when the query operates on a different keyspace than the current {@link Client#keyspace}.
 *
 * [TODO: Add support for this field]
 * @property {boolean} [logged] Determines if the batch should be written to the batchlog. Only valid for
 * [Client#batch()]{@link Client#batch}, it will be ignored by other methods. Default: true.
 * [TODO: Add support for this field]
 * @property {boolean} [counter] Determines if its a counter batch. Only valid for
 * [Client#batch()]{@link Client#batch}, it will be ignored by other methods. Default: false.
 * [TODO: Add support for this field]
 * @property {boolean} [paged] Determines if the query should be paged. Default: true.
 * @property {Buffer|string} [pageState] Buffer or string token representing the paging state.
 *
 * Useful for manual paging, if provided, the query will be executed starting from a given paging state.
 * [TODO: Add support for this field]
 * @property {boolean} [prepare] Determines if the query must be executed as a prepared statement.
 * @property {number} [readTimeout] When defined, it overrides the default read timeout
 * (`socketOptions.readTimeout`) in milliseconds for this execution per coordinator.
 *
 * Suitable for statements for which the coordinator may allow a longer server-side timeout, for example aggregation
 * queries.
 *
 * A value of `0` disables client side read timeout for the execution. Default: `undefined`.
 *
 * [TODO: Add support for this field]
 * @property {RetryPolicy} [retry] Retry policy for the query.
 *
 * This property can be used to specify a different [retry policy]{@link module:policies/retry} to the one specified
 * in the {@link ClientOptions}.policies.
 * [TODO: Add support for this field]
 * @property {Array} [routingIndexes] Index of the parameters that are part of the partition key to determine
 * the routing.
 * [TODO: Add support for this field]
 * @property {Buffer|Array} [routingKey] Partition key(s) to determine which coordinator should be used for the query.
 * [TODO: Add support for this field]
 * @property {Array} [routingNames] Array of the parameters names that are part of the partition key to determine the
 * routing. Only valid for non-prepared requests, it's recommended that you use the prepare flag instead.
 * [TODO: Add support for this field]
 * @property {number} [serialConsistency] Serial consistency is the consistency level for the serial phase of
 * conditional updates.
 * This option will be ignored for anything else that a conditional update/insert.
 * [TODO: Add support for this field]
 * @property {number|Long} [timestamp] The default timestamp for the query in microseconds from the unix epoch
 * (00:00:00, January 1st, 1970).
 *
 * If provided, this will replace the server side assigned timestamp as default timestamp.
 *
 * Use [generateTimestamp()]{@link module:types~generateTimestamp} utility method to generate a valid timestamp
 * based on a Date and microseconds parts.
 * @property {boolean} [traceQuery] Enable query tracing for the execution. Use query tracing to diagnose performance
 * problems related to query executions. Default: false.
 *
 * To retrieve trace, you can call [Metadata.getTrace()]{@link module:metadata~Metadata#getTrace} method.
 */

/**
 * Parses js query options into rust query options wrapper
 * @param {_execOptions.ExecutionOptions} options
 * @returns {rust.QueryOptionsWrapper}
 * @package
 */
function queryOptionsIntoWrapper(options) {
    let rustOptions = Object();

    rustOptions.autoPage = options.isAutoPage();
    rustOptions.captureStackTrace = options.getCaptureStackTrace();
    rustOptions.consistency = options.getConsistency();
    rustOptions.counter = options.counter;
    rustOptions.fetchSize = options.getFetchSize();
    rustOptions.isIdempotent = options.isIdempotent();
    rustOptions.keyspace = options.keyspace;
    rustOptions.logged = options.logged;
    rustOptions.prepare = options.prepare;
    rustOptions.readTimeout = options.getReadTimeout();
    rustOptions.routingIndexes = options.getRoutingIndexes();
    rustOptions.routingNames = options.getRoutingNames();
    rustOptions.serialConsistency = options.getSerialConsistency();
    let timestamp = options.getTimestamp();
    if (timestamp instanceof Long) timestamp = timestamp.toBigInt();
    else if (timestamp) timestamp = BigInt(timestamp);
    rustOptions.timestamp = timestamp;
    rustOptions.traceQuery = options.isQueryTracing();
    let wrapper = new rust.QueryOptionsWrapper(rustOptions);
    return wrapper;
}

module.exports.queryOptionsIntoWrapper = queryOptionsIntoWrapper;
