"use strict";

const events = require("events");
const util = require("util");
const { throwNotSupported } = require("./new-utils.js");

const utils = require("./utils.js");
const errors = require("./errors.js");
const types = require("./types");
const { ProfileManager } = require("./execution-profile");
const clientOptions = require("./client-options");
const ClientState = require("./metadata/client-state");
const description = require("../package.json").description;
const { version } = require("../package.json");
const ExecOptions = require("./execution-options");
const promiseUtils = require("./promise-utils");
const rust = require("../index");
const ResultSet = require("./types/result-set.js");
const { encodeParams, convertComplexType } = require("./types/cql-utils.js");
const { PreparedCache } = require("./cache.js");
const Encoder = require("./encoder.js");
const { HostMap } = require("./host.js");

/**
 * Represents a database client that maintains multiple connections to the cluster nodes, providing methods to
 * execute CQL statements.
 *
 * The `Client` uses [policies]{@link module:policies} to decide which nodes to connect to, which node
 * to use per each query execution, when it should retry failed or timed-out executions and how reconnection to down
 * nodes should be made.
 * @extends EventEmitter
 * @example <caption>Creating a new client instance</caption>
 * const client = new Client({
 *   contactPoints: ['10.0.1.101', '10.0.1.102'],
 * });
 * @example <caption>Executing a query</caption>
 * const result = await client.connect();
 * console.log(`Connected to ${client.hosts.length} nodes in the cluster: ${client.hosts.keys().join(', ')}`);
 * @example <caption>Executing a query</caption>
 * const result = await client.execute('SELECT key FROM system.local');
 * const row = result.first();
 * console.log(row['key']);
 */
class Client extends events.EventEmitter {
    #encoder;
    /**
     * Creates a new instance of {@link Client}.
     * @param {clientOptions.ClientOptions} options The options for this instance.
     */
    constructor(options) {
        super();
        /** @type {clientOptions.ClientOptions} */
        this.options = clientOptions.extend(
            { logEmitter: this.emit.bind(this), id: types.Uuid.random() },
            options,
        );

        this.rustOptions = clientOptions.setRustOptions(this.options);

        Object.defineProperty(this, "profileManager", {
            value: new ProfileManager(this.options),
        });
        // Unlimited amount of listeners for internal event queues by default
        this.setMaxListeners(0);
        this.connected = false;
        this.isShuttingDown = false;
        /**
         * Gets the schema and cluster metadata information.
         * TODO: This field is currently not supported
         * @type {Metadata}
         */
        this.metadata = undefined;

        /**
         * The [ClientMetrics]{@link module:metrics~ClientMetrics} instance used to expose measurements of its internal
         * behavior and of the server as seen from the driver side.
         *
         * By default, a [DefaultMetrics]{@link module:metrics~DefaultMetrics} instance is used.
         * @type {ClientMetrics}
         */
        this.metrics = this.options.metrics;

        // TODO: This field is currently hardcoded. Should be implemented properly
        this.#encoder = new Encoder(0x04, this.options.encoding);
    }

    /**
     * Emitted when a new host is added to the cluster.
     * - {@link Host} The host being added.
     * @event Client#hostAdd
     */
    /**
     * Emitted when a host is removed from the cluster
     * - {@link Host} The host being removed.
     * @event Client#hostRemove
     */
    /**
     * Emitted when a host in the cluster changed status from down to up.
     * - {@link Host host} The host that changed the status.
     * @event Client#hostUp
     */
    /**
     * Emitted when a host in the cluster changed status from up to down.
     * - {@link Host host} The host that changed the status.
     * @event Client#hostDown
     */

    /**
     * Gets the name of the active keyspace.
     * @type {string | undefined}
     */
    get keyspace() {
        return this.rustClient.getKeyspace();
    }

    set keyspace(_) {
        throw new SyntaxError("Client keyspace is read-only");
    }

    /**
     * Gets an associative array of cluster hosts.
     * @type {HostMap}
     */
    get hosts() {
        // For now we retrieve all the hosts per each access to this field.
        // This may be inefficient when user works directly with this field multiple times,
        // but with this approach we shift the responsibility of ensuring validity of the data to Rust driver
        return HostMap.fromRust(this.rustClient.getAllHosts());
    }

    set hosts(_) {
        throw new SyntaxError("Client hosts is read-only");
    }
    /**
     * Manually create final execution options, applying client and default setting.
     *
     * Creating those options requires a native call, but they can be reused
     * without any additional native calls, which improves performance
     * for queries with the same QueryOptions.
     * @param {queryOptions.QueryOptions | ExecOptions.ExecutionOptions} [options]
     * @returns {ExecOptions.ExecutionOptions}
     * @package
     */
    createOptions(options) {
        if (options instanceof ExecOptions.ExecutionOptions) {
            options.wrapOptionsIfNotWrappedYet();
            return options;
        }
        let fullOptions = ExecOptions.DefaultExecutionOptions.create(
            options,
            this,
        );
        fullOptions.wrapOptionsIfNotWrappedYet();
        return fullOptions;
    }

    /**
     * Manually prepare query into prepared statement
     * @param {string} query
     * @returns {Promise<list<Object | string>>}
     * Returns a tuple of type object (the format expected by the encoder) and prepared statement wrapper
     * @package
     */
    async prepareQuery(query) {
        let expectedTypes = await this.rustClient.prepareStatement(query);
        let res = [expectedTypes.map((t) => convertComplexType(t)), query];
        return res;
    }

    /**
     * Attempts to connect to one of the [contactPoints]{@link ClientOptions} and discovers the rest the nodes of the
     * cluster.
     *
     * When the {@link Client} is already connected, it resolves immediately.
     *
     * It returns a `Promise` when a `callback` is not provided.
     * @param {function} [callback] The optional callback that is invoked when the pool is connected or it failed to
     * connect.
     * @example <caption>Usage example</caption>
     * await client.connect();
     */
    connect(callback) {
        if (this.connected && callback) {
            // Avoid creating Promise to immediately resolve them
            return callback();
        }

        return promiseUtils.optionalCallback(this.#connect(), callback);
    }

    /**
     * Async-only version of {@link Client#connect()}.
     * @private
     */
    async #connect() {
        if (this.connected) {
            return;
        }

        if (this.isShuttingDown) {
            // it is being shutdown, don't allow further calls to connect()
            throw new errors.NoHostAvailableError(
                null,
                "Connecting after shutdown is not supported",
            );
        }

        if (this.connecting) {
            return promiseUtils.fromEvent(this, "connected");
        }

        this.connecting = true;
        this.log(
            "info",
            util.format(
                "Connecting to cluster using '%s' version %s",
                description,
                version,
            ),
        );

        try {
            this.rustClient = await rust.SessionWrapper.createSession(
                this.rustOptions,
            );
        } catch (err) {
            // We should close the pools (if any) and reset the state to allow successive calls to connect()
            this.connected = false;
            this.connecting = false;
            this.emit("connected", err);
            throw err;
        }

        this.connected = true;
        this.connecting = false;
        this.emit("connected");
    }

    /**
     * Executes a query on an available connection.
     *
     * The query can be prepared (recommended) or not depending on the [prepare]{@linkcode QueryOptions} flag.
     *
     * Some execution failures can be handled transparently by the driver, according to the
     * [RetryPolicy]{@linkcode module:policies/retry~RetryPolicy} or the
     * [SpeculativeExecutionPolicy]{@linkcode module:policies/speculativeExecution} used.
     *
     * It returns a `Promise` when a `callback` is not provided.
     *
     * @param {string} query The query to execute.
     * @param {Array|Object} [params] Array of parameter values or an associative array (object) containing parameter names
     * as keys and its value.
     * @param {queryOptions.QueryOptions} [options] The query options for the execution.
     * @param {ResultCallback} [callback] Executes callback(err, result) when execution completed. When not defined, the
     * method will return a promise.
     * @example <caption>Promise-based API, using async/await</caption>
     * const query = 'SELECT name, email FROM users WHERE id = ?';
     * const result = await client.execute(query, [ id ], { prepare: true });
     * const row = result.first();
     * console.log('%s: %s', row['name'], row['email']);
     * @example <caption>Callback-based API</caption>
     * const query = 'SELECT name, email FROM users WHERE id = ?';
     * client.execute(query, [ id ], { prepare: true }, function (err, result) {
     *   assert.ifError(err);
     *   const row = result.first();
     *   console.log('%s: %s', row['name'], row['email']);
     * });
     * @see {@link ExecutionProfile} to reuse a set of options across different query executions.
     */
    execute(query, params, options, callback) {
        // This method acts as a wrapper for the async method #execute(), replaced by #rustyExecute()

        if (!callback) {
            // Set default argument values for optional parameters
            if (typeof options === "function") {
                callback = options;
                options = null;
            } else if (typeof params === "function") {
                callback = params;
                params = null;
            }
        }

        try {
            const execOptions = this.createOptions(options);
            if (execOptions.isPaged()) {
                return promiseUtils.optionalCallback(
                    this.#rustyPaged(query, params, execOptions).then(
                        (e) => e[1],
                    ),
                    callback,
                );
            }

            return promiseUtils.optionalCallback(
                this.rustyExecute(query, params, execOptions),
                callback,
            );
        } catch (err) {
            // There was an error when parsing the user options
            if (callback) {
                return callback(err);
            }

            return Promise.reject(err);
        }
    }

    /**
     * Wrapper for executing queries by rust driver
     * @param {string | list<Object | string>} query
     * @param {Array} params
     * @param {ExecOptions.ExecutionOptions} execOptions
     * @returns {Promise<ResultSet>}
     * @package
     */
    async rustyExecute(query, params, execOptions) {
        if (
            // !execOptions.isPrepared() &&
            params &&
            !Array.isArray(params)
            // && !types.protocolVersion.supportsNamedParameters(version)
        ) {
            throw new Error(`TODO: Implement any support for named parameters`);
            // // Only Cassandra 2.1 and above supports named parameters
            // throw new errors.ArgumentError(
            //   "Named parameters for simple statements are not supported, use prepare flag",
            // );
        }

        if (!this.connected) {
            // TODO: Check this logic and decide if it's needed. Probably do it while implementing (better) connection
            // // Micro optimization to avoid an async execution for a simple check
            await this.#connect();
        }

        let rustOptions = execOptions.getRustOptions();
        let result;

        if (execOptions.isPrepared()) {
            // If the statement is already prepared, skip the preparation process
            // Otherwise call Rust part to prepare a statement
            if (typeof query === "string") {
                query = await this.prepareQuery(query);
            }

            /**
             * @type {string}
             */
            let statement = query[1];
            /**
             * @type {Object}
             */
            let expectedTypes = query[0];

            let encoded = encodeParams(expectedTypes, params, this.#encoder);

            // Execute query
            result = await this.rustClient.executePreparedUnpagedEncoded(
                statement,
                encoded,
                rustOptions,
            );
        } else {
            // We do not accept already prepared statements for unprepared queries
            if (typeof query !== "string") {
                throw new Error("Expected to obtain a string query");
            }

            // Parse parameters according to provided hints, with type guessing
            let encoded = encodeParams(
                execOptions.getHints() || [],
                params,
                this.#encoder,
            );

            // Execute query
            result = await this.rustClient.queryUnpagedEncoded(
                query,
                encoded,
                rustOptions,
            );
        }
        return new ResultSet(result);
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    executeGraph() {
        throwNotSupported("Client.executeGraph");
    }

    /**
     * Executes the query and calls `rowCallback` for each row as soon as they are received. Calls the final
     * `callback` after all rows have been sent, or when there is an error.
     *
     * The query can be prepared (recommended) or not depending on the [prepare]{@linkcode QueryOptions} flag.
     *
     * @param {string} query The query to execute
     * @param {Array|Object} [params] Array of parameter values or an associative array (object) containing parameter names
     * as keys and its value.
     * @param {queryOptions.QueryOptions} [options] The query options.
     * @param {function} rowCallback Executes `rowCallback(n, row)` per each row received, where n is the row
     * index and row is the current Row.
     * @param {function} [callback] Executes `callback(err, result)` after all rows have been received.
     *
     * When dealing with paged results, [ResultSet#nextPage()]{@link module:types~ResultSet#nextPage} method can be used
     * to retrieve the following page. In that case, `rowCallback()` will be again called for each row and
     * the final callback will be invoked when all rows in the following page has been retrieved.
     *
     * @example <caption>Using per-row callback and arrow functions</caption>
     * client.eachRow(query, params, { prepare: true }, (n, row) => console.log(n, row), err => console.error(err));
     * @example <caption>Overloads</caption>
     * client.eachRow(query, rowCallback);
     * client.eachRow(query, params, rowCallback);
     * client.eachRow(query, params, options, rowCallback);
     * client.eachRow(query, params, rowCallback, callback);
     * client.eachRow(query, params, options, rowCallback, callback);
     */
    eachRow(query, params, options, rowCallback, callback) {
        if (!callback && rowCallback && typeof options === "function") {
            callback = utils.validateFn(rowCallback, "rowCallback");
            rowCallback = options;
        } else {
            callback = callback || utils.noop;
            rowCallback = utils.validateFn(
                rowCallback || options || params,
                "rowCallback",
            );
        }

        params = typeof params !== "function" ? params : null;

        /**
         * @type {ExecOptions.ExecutionOptions}
         */
        let execOptions;
        try {
            execOptions = ExecOptions.DefaultExecutionOptions.create(
                options,
                this,
            );
        } catch (e) {
            return callback(e);
        }

        let rowLength = 0;
        let pagingState = null;

        const nextPage = () => {
            promiseUtils.toCallback(
                this.#rustyPaged(query, params, execOptions, pagingState),
                pageCallback,
            );
        };

        /**
         * @param {Error} err
         * @param {Array<rust.PagingStateResponseWrapper, ResultSet>} result
         * Should be [rust.PagingStateResponseWrapper, ResultSet]
         */
        function pageCallback(err, result) {
            if (err) {
                return callback(err);
            }
            /**
             * Next requests in case paging (auto or explicit) is used
             */
            let lastPagingState = result[0];
            let queryResult = result[1];

            rowLength += queryResult.rowLength;

            if (queryResult.rows) {
                queryResult.rows.forEach((value, index) => {
                    rowCallback(index, value);
                });
            }

            if (lastPagingState) {
                // Use new page state as next request page state
                pagingState = lastPagingState;

                if (execOptions.isAutoPage()) {
                    // Issue next request for the next page
                    return nextPage();
                }
                // Allows for explicit (manual) paging, in case the caller needs it
                queryResult.nextPage = nextPage;
            }

            // Finished auto-paging
            queryResult.rowLength = rowLength;
            callback(null, queryResult);
        }

        promiseUtils.toCallback(
            this.#rustyPaged(query, params, execOptions, pagingState),
            pageCallback,
        );
    }

    /**
     * Execute a single page of query
     * @param {string} query
     * @param {Array} params
     * @param {ExecOptions.ExecutionOptions} execOptions
     * @param {rust.PagingStateWrapper|Buffer} [pageState]
     * @returns {Promise<Array<rust.PagingStateResponseWrapper, ResultSet>>} should be Promise<[rust.PagingStateResponseWrapper, ResultSet]>
     * @private
     */
    async #rustyPaged(query, params, execOptions, pageState) {
        if (
            !execOptions.isPrepared() &&
            params &&
            !Array.isArray(params)
            // && !types.protocolVersion.supportsNamedParameters(version)
        ) {
            throw new Error(`TODO: Implement any support for named parameters`);
            // // Only Cassandra 2.1 and above supports named parameters
            // throw new errors.ArgumentError(
            //   "Named parameters for simple statements are not supported, use prepare flag",
            // );
        }

        if (!this.connected) {
            // TODO: Check this logic and decide if it's needed. Probably do it while implementing (better) connection
            // // Micro optimization to avoid an async execution for a simple check
            await this.#connect();
        }

        if (pageState instanceof Buffer) {
            pageState = rust.PagingStateWrapper.fromBuffer(pageState);
        } else if (pageState == undefined) {
            // Take the page state option into account only when we don't pass it explicitly (it's done only in eachRow)
            if (execOptions.getPageState() instanceof Buffer) {
                pageState = rust.PagingStateWrapper.fromBuffer(
                    execOptions.getPageState(),
                );
            } else if (typeof execOptions.pageState === "string") {
                pageState = rust.PagingStateWrapper.fromBuffer(
                    Buffer.from(execOptions.getPageState(), "hex"),
                );
            }
        }
        const rustOptions = execOptions.getRustOptions();
        let result;
        if (execOptions.isPrepared()) {
            // If the statement is already prepared, skip the preparation process
            // Otherwise call Rust part to prepare a statement
            if (typeof query === "string") {
                query = await this.prepareQuery(query);
            }

            /**
             * @type {string}
             */
            let statement = query[1];
            /**
             * @type {Object}
             */
            let expectedTypes = query[0];

            let encoded = encodeParams(expectedTypes, params, this.#encoder);

            // Execute query
            result = await this.rustClient.executeSinglePageEncoded(
                statement,
                encoded,
                rustOptions,
                pageState,
            );
        } else {
            // We do not accept already prepared statements for unprepared queries
            if (typeof query !== "string") {
                throw new Error("Expected to obtain a string query");
            }
            // Parse parameters according to provided hints, with type guessing
            let encoded = encodeParams(
                execOptions.getHints() || [],
                params,
                this.#encoder,
            );

            // Execute query
            result = await this.rustClient.querySinglePageEncoded(
                query,
                encoded,
                rustOptions,
                pageState,
            );
        }
        /**
         * @type {rust.QueryExecutor}
         */
        let executor = result[2];
        // result[0] - information about page state
        // result[1] - object representing result itself
        let resultSet = new ResultSet(result[1], result[0]);
        if (result[0]) {
            resultSet.rawNextPageAsync = async (pageState) => {
                return await executor.fetchNextPage(
                    this.rustClient,
                    rust.PagingStateWrapper.fromBuffer(pageState),
                );
            };
        }
        result[1] = resultSet;

        return result;
    }

    /**
     * Executes the query and pushes the rows to the result stream as soon as they received.
     *
     * The stream is a [ReadableStream]{@linkcode https://nodejs.org/api/stream.html#stream_class_stream_readable} object
     * that emits rows.
     * It can be piped downstream and provides automatic pause/resume logic (it buffers when not read).
     *
     * The query can be prepared (recommended) or not depending on {@link QueryOptions}.prepare flag. Retries on multiple
     * hosts if needed.
     *
     * @param {string} query The query to prepare and execute.
     * @param {Array|Object} [params] Array of parameter values or an associative array (object) containing parameter names
     * as keys and its value
     * @param {queryOptions.QueryOptions} [options] The query options.
     * @param {function} [callback] executes callback(err) after all rows have been received or if there is an error
     * @returns {types.types.ResultStream}
     */
    stream(query, params, options, callback) {
        callback = callback || utils.noop;
        // NOTE: the nodejs stream maintains yet another internal buffer
        // we rely on the default stream implementation to keep memory
        // usage reasonable.
        const resultStream = new types.ResultStream({ objectMode: 1 });
        function onFinish(err, result) {
            if (err) {
                resultStream.emit("error", err);
            }
            if (result && result.nextPage) {
                // allows for throttling as per the
                // default nodejs stream implementation
                resultStream._valve(function pageValve() {
                    try {
                        result.nextPage();
                    } catch (ex) {
                        resultStream.emit("error", ex);
                    }
                });
                return;
            }
            // Explicitly dropping the valve (closure)
            resultStream._valve(null);
            resultStream.add(null);
            callback(err);
        }
        let sync = true;
        this.eachRow(
            query,
            params,
            options,
            function rowCallback(n, row) {
                resultStream.add(row);
            },
            function eachRowFinished(err, result) {
                if (sync) {
                    // Prevent sync callback
                    return setImmediate(function eachRowFinishedImmediate() {
                        onFinish(err, result);
                    });
                }
                onFinish(err, result);
            },
        );
        sync = false;
        return resultStream;
    }

    /**
     * Executes batch of queries on an available connection to a host.
     *
     * It returns a `Promise` when a `callback` is not provided.
     *
     * @param {Array.<string>|Array.<{query, params}>} queries The queries to execute as an Array of strings or as an array
     * of object containing the query and params
     * @param {queryOptions.QueryOptions} [options] The query options.
     * @param {ResultCallback} [callback] Executes callback(err, result) when the batch was executed
     */
    batch(queries, options, callback) {
        if (!callback && typeof options === "function") {
            callback = options;
            options = null;
        }

        return promiseUtils.optionalCallback(
            this.#rustyBatch(queries, options),
            callback,
        );
    }

    /**
     * Async-only version of {@link Client#batch()} .
     * @param {Array.<string>|Array.<{query: string, params: Array}>}queries
     * @param {queryOptions.QueryOptions} options
     * @returns {Promise<ResultSet>}
     * @private
     */
    async #rustyBatch(queries, options) {
        if (!Array.isArray(queries)) {
            throw new errors.ArgumentError("Queries should be an Array");
        }

        if (queries.length === 0) {
            throw new errors.ArgumentError("Queries array should not be empty");
        }

        await this.#connect();

        const execOptions = this.createOptions(options);

        let shouldBePrepared = execOptions.isPrepared();
        let allQueries = [];
        let parametersRows = [];
        let hints = execOptions.getHints() || [];
        let preparedCache = new PreparedCache();

        for (let i = 0; i < queries.length; i++) {
            let element = queries[i];
            if (!element) {
                throw new errors.ArgumentError(`Invalid query at index ${i}`);
            }
            let statement =
                typeof element === "string" ? element : element.query;
            let params = element.params || [];
            let types;

            if (!statement) {
                throw new errors.ArgumentError(`Invalid query at index ${i}`);
            }

            if (shouldBePrepared) {
                let prepared = preparedCache.getElement(statement);
                if (!prepared) {
                    prepared = await this.prepareQuery(statement);
                    preparedCache.storeElement(statement, prepared);
                }
                types = prepared[0];
                statement = prepared[1];
            } else {
                types = hints[i] || [];
            }

            if (params) {
                params = encodeParams(types, params, this.#encoder);
            }
            allQueries.push(statement);
            parametersRows.push(params);
        }

        let rustOptions = execOptions.getRustOptions();
        let batch = shouldBePrepared
            ? this.rustClient.createPreparedBatch(allQueries, rustOptions)
            : this.rustClient.createUnpreparedBatch(allQueries, rustOptions);
        let wrappedResult = await this.rustClient.batchEncoded(
            batch,
            parametersRows,
        );
        return new ResultSet(wrappedResult);
    }

    /**
     * Gets the host that are replicas of a given token.
     * @param {string} keyspace
     * @param {Buffer} token
     * @returns {Array<Host>}
     */
    getReplicas(keyspace, token) {
        throw new Error(`TODO: Not implemented`);
        // return this.metadata.getReplicas(keyspace, token);
    }

    /**
     * @returns {ClientState} A dummy [ClientState]{@linkcode module:metadata~ClientState} instance.
     *
     * @deprecated This is not planned feature for the driver. Currently this remains in place, but returns Client state with
     * no information. This endpoint may be removed at any point.
     */
    getState() {
        return ClientState.from(this);
    }

    log = utils.log;

    /**
     * The only effect of calling shutdown is rejecting any following queries to the database.
     *
     * It returns a `Promise` when a `callback` is not provided.
     *
     * @param {Function} [callback] Optional callback to be invoked when finished closing all connections.
     *
     * @deprecated Explicit connection shutdown is deprecated and may be removed in the future.
     * Drop this client to close the connection to the database.
     */
    shutdown(callback) {
        return promiseUtils.optionalCallback(this.#shutdown(), callback);
    }

    /** @private */
    async #shutdown() {
        this.log(
            "warning",
            "Explicit shutdown is deprecated and may be removed in the future.\n" +
                "Drop this client to close the connection to the database.",
        );

        if (!this.connected) {
            // not initialized
            return;
        }

        if (this.connecting) {
            this.log("warning", "Shutting down while connecting");
            // wait until finish connecting for easier troubleshooting
            await promiseUtils.fromEvent(this, "connected");
        }

        this.connected = false;
        this.isShuttingDown = true;
    }

    /**
     * Reject callback
     *
     * @callback RejectCallback
     * @param {any} reason
     * @returns {void}
     */

    /**
     * Resolve callback
     *
     * @callback ResolveCallback
     * @param {ResultSet | PromiseLike<ResultSet>} value
     * @returns {void}
     */
}
/**
 * Callback used by execution methods.
 * @callback ResultCallback
 * @param {Error} err Error occurred in the execution of the query.
 * @param {ResultSet} [result] Result of the execution of the query.
 */

module.exports = Client;
