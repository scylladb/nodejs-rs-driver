"use strict";

import events = require("events");
import util = require("util");
import {
    PreparedInfo,
    isNamedParameters,
    throwNotSupported,
} from "./new-utils";

import assert = require("assert");
import utils = require("./utils");
import errors = require("./errors");
import types = require("./types");
import ResultStream = require("./types/result-stream");
import executionProfile = require("./execution-profile");
import clientOptions = require("./client-options");
import ClientState = require("./metadata/client-state");
import packageInfo = require("../package.json");
import { DefaultExecutionOptions, ExecutionOptions } from "./execution-options";
import { ResultColumnsCache, RustResult } from "./types/results-wrapper";
import { RustSession } from "./rust-session";
import promiseUtils = require("./promise-utils");
import rust = require("../index");
import ResultSet = require("./types/result-set");
import { ColumnInfo, convertComplexType } from "./types/cql-utils";
import Encoder = require("./encoder");
import { HostMap, type Replica } from "./host";
import {
    type QueryOptions,
    type RustQueryOptions,
    batchKindIntoRustArg,
} from "./query-options";
import type { Token, TokenRange } from "./token";

// Imports for the purpose of type hints.
import type { ArrayOrObject, CqlValue, metrics as metricsModule } from "../";
import * as metadataModule from "./metadata";

const { ProfileManager } = executionProfile;
const description = packageInfo.description;
const { version } = packageInfo;

// Initialize the async bridge for this Node.js environment.
// This starts the Tokio runtime that runs the driver's futures
// (session queries, paging, etc.), and the thread-safe function
// that settles their Promises on this thread.
rust.initAsyncBridge();

/**
 * Callback used by execution methods.
 * @param err Error occurred in the execution of the query.
 * @param result Result of the execution of the query.
 */
type ResultCallback = (err?: Error | null, result?: ResultSet) => void;

/**
 * FinalizationRegistry that ensures the Rust logging callback is unregistered
 * when a Client instance is garbage-collected without being explicitly shut down.
 *
 * While in general FinalizationRegistry usage is discouraged, we use it here
 * to avoid blocking the client from being cleaned up, once it's no longer used by the user,
 * and also clean up all the resources in the process.
 * This justifies using finalization registry, despite heavy warnings against it in the documentation.
 *
 * To understand more, check the JS documentation.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
 */
const loggingFinalizationRegistry = new FinalizationRegistry(
    (loggingId: number) => {
        rust.removeLogging(loggingId);
    },
);

/**
 * Represents a database client that maintains multiple connections to the cluster nodes, providing methods to
 * execute CQL statements.
 *
 * The `Client` uses [policies]{@link module:policies} to decide which nodes to connect to, which node
 * to use per each query execution, when it should retry failed or timed-out executions and how reconnection to down
 * nodes should be made.
 * @extends events.EventEmitter
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
    /**
     * @internal
     * @ignore
     */
    rustClient: RustSession | undefined;
    #encoder: Encoder;
    #loggingId: number | undefined;
    // Map insertion order determines which prepared handle is evicted first.
    #preparedCache = new Map<string, PreparedInfo>();
    // Share one preparation among concurrent calls for the same statement.
    #preparing = new Map<string, Promise<PreparedInfo>>();
    /**
     * @internal
     * @ignore
     */
    options: clientOptions.ClientOptions;
    /**
     * @internal
     * @ignore
     */
    rustOptions: ReturnType<typeof clientOptions.setRustOptions>;
    readonly profileManager!: InstanceType<typeof ProfileManager>;
    /**
     * @internal
     * @ignore
     */
    connected: boolean;
    /**
     * @internal
     * @ignore
     */
    connecting?: boolean;
    /**
     * @internal
     * @ignore
     */
    isShuttingDown: boolean;
    /**
     * Gets the schema and cluster metadata information.
     *
     * It is set once the client is connected.
     */
    metadata: metadataModule.Metadata | undefined;
    /**
     * The [ClientMetrics]{@link module:metrics~ClientMetrics} instance used to expose measurements of its internal
     * behavior and of the server as seen from the driver side.
     *
     * By default, a [DefaultMetrics]{@link module:metrics~DefaultMetrics} instance is used.
     * TODO: This field is currently not supported
     */
    metrics: metricsModule.ClientMetrics | undefined;

    /**
     * Creates a new instance of {@link Client}.
     * @param options The options for this instance.
     */
    constructor(options: clientOptions.ClientOptions) {
        super();
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
        this.metadata = undefined;

        this.metrics = undefined;

        // TODO: This field is currently hardcoded. Should be implemented properly
        this.#encoder = new Encoder(0x04, this.options);
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
     */
    get keyspace(): string | undefined {
        if (!this.rustClient) return undefined;
        return this.rustClient.getKeyspace() || undefined;
    }

    set keyspace(_) {
        throw new SyntaxError("Client keyspace is read-only");
    }

    /**
     * Gets an associative array of cluster hosts.
     */
    get hosts(): HostMap {
        if (!this.rustClient) return new HostMap({});

        // rustClient.getAllHosts() attempts to read the cached HostMap from the Rust driver.
        // If no cache is available, or the previous cache is stale, it will trigger a refresh
        // of the host list from the cluster.
        return this.rustClient.getAllHosts();
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
     * @internal
     * @ignore
     */
    createOptions(options?: QueryOptions | ExecutionOptions): ExecutionOptions {
        if (options instanceof ExecutionOptions) {
            options.convertOptionsIfNotConvertedYet();
            return options;
        }
        const fullOptions = DefaultExecutionOptions.create(options, this);
        fullOptions.convertOptionsIfNotConvertedYet();
        return fullOptions;
    }

    /**
     * Reuse a prepared handle and its bind metadata for the same statement.
     * Bind metadata is fixed for the lifetime of the handle, as in the Rust driver.
     * @internal
     * @ignore
     */
    async prepareStatement(statement: string): Promise<PreparedInfo> {
        const cached = this.#preparedCache.get(statement);
        if (cached) {
            // Move a cache hit to the end; the first entry is the LRU victim.
            this.#preparedCache.delete(statement);
            this.#preparedCache.set(statement, cached);
            return cached;
        }
        const inFlight = this.#preparing.get(statement);
        if (inFlight) return inFlight;

        const preparing = (async () => {
            const preparedResult =
                await this.rustClient!.prepareStatement(statement);
            const handle = preparedResult[0];
            const expectedTypes = preparedResult[1];
            const types = expectedTypes.map((t) => convertComplexType(t[0]));
            const boundParamNames = expectedTypes.map((t) =>
                t[1].toLowerCase(),
            );
            const prepared = new PreparedInfo(
                types,
                statement,
                boundParamNames,
                handle,
            );
            const limit = this.options.maxPrepared || 512;
            if (this.#preparedCache.size >= limit) {
                this.#preparedCache.delete(
                    this.#preparedCache.keys().next().value!,
                );
            }
            this.#preparedCache.set(statement, prepared);
            return prepared;
        })();
        this.#preparing.set(statement, preparing);
        try {
            return await preparing;
        } finally {
            if (this.#preparing.get(statement) === preparing) {
                this.#preparing.delete(statement);
            }
        }
    }

    /**
     * Attempts to connect to one of the [contactPoints]{@link ClientOptions} and discovers the rest the nodes of the
     * cluster.
     *
     * When the {@link Client} is already connected, it resolves immediately.
     *
     * It returns a `Promise` when a `callback` is not provided.
     * @param callback The optional callback that is invoked when the pool is connected or it failed to
     * connect.
     * @example <caption>Usage example</caption>
     * await client.connect();
     */
    connect(callback?: Function): Promise<void> | void {
        if (this.connected && callback) {
            // Avoid creating Promise to immediately resolve them
            return callback();
        }

        return promiseUtils.optionalCallback(this.#connect(), callback);
    }

    /**
     * Async-only version of {@link Client#connect()}.
     */
    async #connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        if (this.isShuttingDown) {
            // it is being shutdown, don't allow further calls to connect()
            throw new errors.NoHostAvailableError(
                {},
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
            undefined,
            undefined,
        );

        if (this.options.encoding?.copyBuffer === false) {
            this.log(
                "warning",
                "The encoding.copyBuffer option is deprecated and may be removed in the future.\n" +
                    "Setting it to false does not decrease memory or copy overhead in this driver. " +
                    "Remove this option from the client options.",
                undefined,
                undefined,
            );
        }

        try {
            if (this.options.logLevel !== types.logLevels.off) {
                // We need weak ref, since it lives inside log callback.
                // If it was normal reference, it would block GC of this client instance.
                const weakThis = new WeakRef(this);
                const logLevel =
                    this.options.logLevel || types.logLevels.warning;

                this.#loggingId = rust.setupLogging(
                    (
                        level: string,
                        target: string,
                        message: string,
                        furtherInfo: string,
                    ) => {
                        const self = weakThis.deref();
                        if (!self) {
                            // This callback is removed when logging is disabled.
                            // Since logging is also disabled at GC of the client,
                            // the only reasonable case when we can land here is when the log was triggered
                            // before the finalizer got a chance to call it's logging cleanup logic.
                            return;
                        }
                        self.emit("log", level, target, message, furtherInfo);
                    },
                    logLevel,
                );
                loggingFinalizationRegistry.register(
                    this,
                    this.#loggingId,
                    this,
                );
            }

            this.rustClient = await RustSession.create(
                this.rustOptions,
                this.#encoder,
            );
            this.metadata = new metadataModule.Metadata(this.rustClient);
        } catch (err) {
            const error =
                err instanceof Error && err.name === "InvalidLocalDatacenter"
                    ? new errors.ArgumentError(err.message)
                    : err;
            // We should close the pools (if any) and reset the state to allow successive calls to connect()
            this.connected = false;
            this.connecting = false;
            this.emit("connected", error);
            this.#closeLogging();
            throw error;
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
     * @param query The query to execute.
     * @param params Array of parameter values or an associative array (object) containing parameter names
     * as keys and its value.
     * @param options The query options for the execution.
     * @param callback Executes callback(err, result) when execution completed. When not defined, the
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
    execute(
        query: string,
        params?: ArrayOrObject | ResultCallback,
        options?: QueryOptions | ResultCallback,
        callback?: ResultCallback,
    ): Promise<ResultSet> | void {
        // This method acts as a wrapper for the async method #execute(), replaced by #rustyExecute()

        if (!callback) {
            // Set default argument values for optional parameters
            if (typeof options === "function") {
                callback = options;
                options = undefined;
            } else if (typeof params === "function") {
                callback = params;
                params = undefined;
            }
        }

        try {
            const execOptions = this.createOptions(
                options as QueryOptions | undefined,
            );
            // The rusty execute will take the page state from options, but we need to indicate whether it's a paged query.
            const pageState = execOptions.isPaged() ? null : undefined;
            return promiseUtils.optionalCallback(
                this.rustyExecute(
                    query,
                    (params as ArrayOrObject | undefined) || [],
                    execOptions,
                    pageState,
                ),
                callback,
            );
        } catch (err) {
            let updatedErr;
            if (!(err instanceof Error)) {
                updatedErr = Error(
                    `Improperly thrown error, got ${err}. This is an internal driver error.`,
                );
            } else {
                updatedErr = err;
            }
            // There was an error when parsing the user options
            if (callback) {
                return callback(updatedErr);
            }

            return Promise.reject(updatedErr);
        }
    }

    /**
     * Wrapper for executing queries by rust driver.
     * When called with a pageState argument (including null), executes a single-page query.
     * When called without pageState, executes an unpaged query.
     * @param pageState When provided (including null), enables paged execution.
     * When unprovided (undefined), executes an unpaged query.
     * @internal
     * @ignore
     */
    async rustyExecute(
        query: string | PreparedInfo,
        params: ArrayOrObject,
        execOptions: ExecutionOptions,
        pageState?: Buffer | null,
    ): Promise<ResultSet> {
        // Why not just take execOptions.isPaged()?
        // When executing through eachRow, users may not set the isPaged query option properly
        // (they may set it to false - this is not checked in any place when going through eachRow API at the moment).
        // This should probably be re-worked when stabilizing the API. For now I do not want to restrict the API to avoid
        // accidentally breaking compatibility...
        const paged = pageState !== undefined;
        pageState = normalizePagingState(pageState, execOptions);

        // Called only to ensure proper types are provided
        isNamedParameters(params, execOptions);

        if (!this.connected) {
            // TODO: Check this logic and decide if it's needed. Probably do it while implementing (better) connection
            // // Micro optimization to avoid an async execution for a simple check
            await this.#connect();
        }

        const rustOptions = execOptions.getRustOptions();

        let result: RustResult;
        let columnsCache: ResultColumnsCache | undefined;

        if (execOptions.isPrepared()) {
            const prepared = await this.#resolvePrepared(query);
            result = await this.#rustyExecutePrepared(
                prepared,
                params,
                rustOptions,
                paged,
                pageState,
            );
            columnsCache = prepared.resultColumns;
        } else {
            // This is checked in isNamedParameters. The assert here is to satisfy the TS compiler.
            assert(Array.isArray(params));
            result = await this.#rustyExecuteUnprepared(
                query,
                params,
                execOptions,
                rustOptions,
                paged,
                pageState,
            );
        }

        // Only paged results can have a next page.
        const resultPageState = paged ? result.getPagingState() : null;

        const resultSet = new ResultSet(
            result,
            this.#encoder,
            resultPageState,
            columnsCache,
        );
        if (resultPageState) {
            const executor = result.getExecutor();
            // A result with a next page also has the executor that fetches it.
            assert(executor !== null);

            resultSet.rawNextPageAsync = async (
                pageState: Buffer,
            ): Promise<RustResult> => {
                return new RustResult(
                    await rust.executorFetchNextPage(
                        executor,
                        this.rustClient!.inner,
                        pageState,
                    ),
                );
            };
        }
        return resultSet;
    }

    async #resolvePrepared(
        query: string | PreparedInfo,
    ): Promise<PreparedInfo> {
        // If the statement is already prepared, skip the preparation process
        // Otherwise call Rust part to prepare a statement

        switch (true) {
            case typeof query === "string":
                return await this.prepareStatement(query);
            case query instanceof PreparedInfo:
                // A handle stays valid after cache eviction, so a retained one can be reused.
                return query;
            default:
                throw new TypeError(
                    `Invalid type for query. Got ${query}, expected string or internal prepared info`,
                );
        }
    }

    async #rustyExecutePrepared(
        prepared: PreparedInfo,
        params: ArrayOrObject,
        rustOptions: RustQueryOptions,
        paged: boolean,
        pageState?: Buffer,
    ): Promise<RustResult> {
        let unifiedParams: Array<any>;
        if (Array.isArray(params)) {
            unifiedParams = params;
        } else {
            unifiedParams = utils.adaptNamedParamsPrepared(params, prepared);
        }

        if (paged) {
            return new RustResult(
                await this.rustClient!.executePreparedSinglePage(
                    prepared.handle,
                    prepared.types,
                    unifiedParams,
                    rustOptions,
                    pageState,
                ),
            );
        }
        return new RustResult(
            await this.rustClient!.executePreparedUnpaged(
                prepared.handle,
                prepared.types,
                unifiedParams,
                rustOptions,
            ),
        );
    }

    async #rustyExecuteUnprepared(
        query: string | PreparedInfo,
        params: Array<CqlValue>,
        execOptions: ExecutionOptions,
        rustOptions: RustQueryOptions,
        paged: boolean,
        pageState?: Buffer,
    ): Promise<RustResult> {
        // We do not accept already prepared statements for unprepared queries
        if (typeof query !== "string") {
            throw new Error("Expected to obtain a string query");
        }

        const hints = execOptions.getHints();
        if (hints && hints.length != 0 && Array.isArray(hints[0])) {
            throw TypeError("For single statements expected 1D array of hints");
        }
        const hints2: ColumnInfo[] | undefined = hints as
            | ColumnInfo[]
            | undefined;

        // Parameters are encoded according to provided hints, with type guessing.
        if (paged) {
            return new RustResult(
                await this.rustClient!.querySinglePage(
                    query,
                    hints2 || [],
                    params,
                    rustOptions,
                    pageState,
                ),
            );
        }
        return new RustResult(
            await this.rustClient!.queryUnpaged(
                query,
                hints2 || [],
                params,
                rustOptions,
            ),
        );
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
     * @param query The query to execute
     * @param params Array of parameter values or an associative array (object) containing parameter names
     * as keys and its value.
     * @param options The query options.
     * @param rowCallback Executes `rowCallback(n, row)` per each row received, where n is the row
     * index and row is the current Row.
     * @param callback Executes `callback(err, result)` after all rows have been received.
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
    eachRow(
        query: string,
        params?: ArrayOrObject | Function,
        options?: QueryOptions | Function,
        rowCallback?: Function,
        callback?: Function,
    ) {
        let cleanCallback: Function;
        if (!callback && rowCallback && typeof options === "function") {
            cleanCallback = utils.validateFn(rowCallback, "rowCallback");
            rowCallback = options;
        } else {
            cleanCallback = callback || utils.noop;
            const tempRowCallback = rowCallback || options || params;
            assert(
                tempRowCallback instanceof Function,
                "Improper overload of each row. Expected row callback to be a function",
            );
            rowCallback = utils.validateFn(tempRowCallback, "rowCallback");
        }

        params = typeof params !== "function" ? params : undefined;

        let execOptions: ExecutionOptions;
        try {
            execOptions = DefaultExecutionOptions.create(options, this);
        } catch (e) {
            return cleanCallback(e);
        }

        let rowLength = 0;
        let fetchPage: ResultSet["rawNextPageAsync"];
        let columnsCache: ResultColumnsCache | undefined;
        let pageState: Buffer | undefined;
        let fetchedFirstPage = false;

        const fetchNextPage = async (): Promise<ResultSet> => {
            if (!this.connected) {
                await this.#connect();
            }
            if (!fetchPage || !pageState) {
                throw new errors.DriverInternalError(
                    "Next page executor or paging state is missing",
                );
            }
            const rawResult = await fetchPage(pageState);
            const pagingState = rawResult.getPagingState();
            const result = new ResultSet(
                rawResult,
                this.#encoder,
                pagingState,
                columnsCache,
            );
            if (pagingState) {
                result.rawNextPageAsync = fetchPage;
            }
            return result;
        };

        const nextPage = () => {
            promiseUtils.toCallback(
                fetchedFirstPage
                    ? fetchNextPage()
                    : this.rustyExecute(
                          query,
                          (params as ArrayOrObject | undefined) || [],
                          execOptions,
                          null,
                      ),
                pageCallback,
            );
        };

        function pageCallback(err: Error, result: ResultSet) {
            if (err) {
                return cleanCallback(err);
            }
            /**
             * Next requests in case paging (auto or explicit) is used
             */
            rowLength += result.rowLength;

            if (result.rows) {
                result.rows.forEach((value, index) => {
                    rowCallback!(index, value);
                });
            }

            if (result.rawPageState) {
                fetchedFirstPage = true;
                fetchPage = result.rawNextPageAsync;
                columnsCache = result.columnsCache;
                pageState = result.rawPageState;

                if (execOptions.isAutoPage()) {
                    // Issue next request for the next page
                    return nextPage();
                }
                // Allows for explicit (manual) paging, in case the caller needs it
                result.nextPage = nextPage;
            }

            // Finished auto-paging
            result.rowLength = rowLength;
            cleanCallback(null, result);
        }

        nextPage();
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
     * @param query The query to prepare and execute.
     * @param params Array of parameter values or an associative array (object) containing parameter names
     * as keys and its value
     * @param options The query options.
     * @param callback executes callback(err) after all rows have been received or if there is an error
     */
    stream(
        query: string,
        params?: ArrayOrObject,
        options?: QueryOptions,
        callback?: Function,
    ): ResultStream {
        const cleanCallback = callback || utils.noop;
        // NOTE: the nodejs stream maintains yet another internal buffer
        // we rely on the default stream implementation to keep memory
        // usage reasonable.
        const resultStream = new ResultStream({ objectMode: true });
        function onFinish(err: any, result: { nextPage: Function }) {
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
            cleanCallback(err);
        }
        let sync = true;
        this.eachRow(
            query,
            params,
            options,
            function rowCallback(n: any, row: any) {
                resultStream.add(row);
            },
            function eachRowFinished(err: any, result: { nextPage: Function }) {
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
     * @param queries The queries to execute as an Array of strings or as an array
     * of object containing the query and params.
     * @param options The query options.
     * @param callback Executes callback(err, result) when the batch was executed
     */
    batch(
        queries: Array<string | { query: string; params?: ArrayOrObject }>,
        options?: QueryOptions | ResultCallback,
        callback?: ResultCallback,
    ): Promise<ResultSet> | void {
        if (!callback && typeof options === "function") {
            callback = options;
            options = undefined;
        }

        return promiseUtils.optionalCallback(
            this.#rustyBatch(queries, options as QueryOptions | undefined),
            callback,
        );
    }

    /**
     * Async-only version of {@link Client#batch()} .
     */
    async #rustyBatch(
        queries: Array<string | { query: string; params?: ArrayOrObject }>,
        options?: QueryOptions,
    ): Promise<ResultSet> {
        if (!Array.isArray(queries)) {
            throw new errors.ArgumentError("Queries should be an Array");
        }

        if (queries.length === 0) {
            throw new errors.ArgumentError("Queries array should not be empty");
        }

        // Validate options before connecting so invalid options cannot open a session.
        const execOptions = this.createOptions(options);

        await this.#connect();

        const shouldBePrepared = execOptions.isPrepared();
        const allQueries: string[] = [];
        const allPrepared: PreparedInfo[] = [];
        const allTypes: Array<Array<ColumnInfo | null>> = [];
        const allParams: Array<Array<any>> = [];
        const hints = execOptions.getHints() || [];

        for (let i = 0; i < queries.length; i++) {
            const element = queries[i];
            if (!element) {
                throw new errors.ArgumentError(`Invalid query at index ${i}`);
            }
            const statement =
                typeof element === "string" ? element : element.query;
            const params: object | Array<any> =
                typeof element !== "string" ? element.params || [] : [];
            let cleanParams: Array<any>;
            let types;

            if (!statement) {
                throw new errors.ArgumentError(`Invalid query at index ${i}`);
            }

            // Called only to ensure proper types are provided
            isNamedParameters(params, execOptions);

            if (shouldBePrepared) {
                // prepareStatement reuses cached handles, also for repeated statements in this batch.
                const prepared = await this.prepareStatement(statement);
                types = prepared.types;
                allPrepared.push(prepared);

                if (Array.isArray(params)) {
                    cleanParams = params;
                } else {
                    cleanParams = utils.adaptNamedParamsPrepared(
                        params,
                        prepared,
                    );
                }
            } else {
                // This assertion will always pass, since we (for now) disallow named parameters in unprepared statements
                assert(Array.isArray(params));
                cleanParams = params;
                types = hints[i] || [];
            }

            allQueries.push(statement);
            allTypes.push(types);
            allParams.push(cleanParams || []);
        }

        const rustOptions = execOptions.getRustOptions();
        const batchKind = batchKindIntoRustArg(execOptions);
        const wrappedResult = new RustResult(
            shouldBePrepared
                ? await this.rustClient!.batchPrepared(
                      allPrepared.map((prepared) => prepared.handle),
                      allTypes,
                      allParams,
                      rustOptions,
                      batchKind,
                  )
                : await this.rustClient!.batch(
                      allQueries,
                      allTypes,
                      allParams,
                      rustOptions,
                      batchKind,
                  ),
        );
        return new ResultSet(wrappedResult, this.#encoder);
    }

    /**
     * Gets the replicas of a given token, for a keyspace and table.
     *
     * A replica is the shard of a node the partition lives on, paired with that node.
     * The hosts returned are the very same objects the {@link Client#hosts} map holds,
     * so a replica's node can be compared against a host of the cluster by identity.
     * @param {string} keyspace Name of the keyspace.
     * @param {string} table Name of the table the token belongs to. For tablets,
     * this field is absolutely necessary. For vnodes, the table is irrelevant, so an
     * empty string can be passed.
     * @param {Token | TokenRange} token Token or TokenRange.
     */
    getReplicas(
        keyspace: string,
        table: string,
        token: Token | TokenRange,
    ): Replica[] {
        return this.metadata!.getReplicas(keyspace, table, token);
    }

    /**
     * @returns A dummy [ClientState]{@linkcode module:metadata~ClientState} instance.
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
     * @param callback Optional callback to be invoked when finished closing all connections.
     *
     * @deprecated Explicit connection shutdown is deprecated and may be removed in the future.
     * Drop this client to close the connection to the database.
     */
    shutdown(callback?: Function): Promise<void> | void {
        return promiseUtils.optionalCallback(this.#shutdown(), callback);
    }

    async #shutdown(): Promise<void> {
        this.log(
            "warning",
            "Explicit shutdown is deprecated and may be removed in the future.\n" +
                "Drop this client to close the connection to the database.",
            undefined,
            undefined,
        );

        if (!this.connected) {
            // not initialized
            return;
        }

        if (this.connecting) {
            this.log(
                "warning",
                "Shutting down while connecting",
                undefined,
                undefined,
            );
            // wait until finish connecting for easier troubleshooting
            await promiseUtils.fromEvent(this, "connected");
        }

        this.connected = false;
        this.isShuttingDown = true;

        this.#closeLogging();
    }

    #closeLogging() {
        if (this.#loggingId !== undefined) {
            rust.removeLogging(this.#loggingId);
            this.#loggingId = undefined;
            // Avoid double-free. While Rust logic doesn't forbid it,
            // there is no need to keep the registry, after the callback is removed.
            loggingFinalizationRegistry.unregister(this);
        }
    }
}

/**
 * This function normalizes the type, and combines all possible page state sources.
 *
 * Page state can come from two sources:
 * - pageState variable: when we execute the following page of the query
 * - execOptions: when the user start a new query from requested state
 *
 * PageState has a priority over execOptions, as execOptions.pageState
 * will not be cleared for the following pages of the execution.
 */
function normalizePagingState(
    pageState: Buffer | null | undefined,
    execOptions: ExecutionOptions,
): Buffer | undefined {
    const optionsPageState = execOptions.getPageState();
    switch (true) {
        // Paging is disabled, so we do not care about value of paging state
        case pageState === undefined:
            return undefined;
        // Paging is enabled, but no one has provided starting page state - undefined represents such case
        case pageState === null && optionsPageState == undefined:
            return undefined;
        // Normalize pageState first, since it has a priority over execOptions
        case pageState instanceof Buffer:
            return pageState;
        // If we have paging enabled, but no page state from last page, normalize exec options page state
        case pageState === null && optionsPageState instanceof Buffer:
            return optionsPageState;
        case pageState === null && typeof optionsPageState === "string":
            return Buffer.from(optionsPageState, "hex");
        default:
            // Only cases with invalid types will be caught here: all accepted types are accepted in the earlier branches
            throw new TypeError(
                `Invalid paging state. Provided PageState ${pageState}, execOptions pageState ${optionsPageState}`,
            );
    }
}

export = Client;
