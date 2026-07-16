"use strict";

const _Client = require("../client");
const utils = require("../utils");
const { Stream } = require("stream");
const { PreparedCache } = require("../cache");

/**
 * Utilities for concurrent query execution with the DataStax Node.js Driver.
 * @module concurrent
 */

/**
 * Executes multiple queries concurrently at the defined concurrency level.
 * @static
 * @param {Client} client The {@link Client} instance.
 * @param {String|Array<{query, params}>} query The query to execute per each parameter item.
 * @param {Array<Array<any>>|Stream|Object} parameters An {@link Array} or a readable {@link Stream} composed of {@link Array}
 * items representing each individual set of parameters. Per each item in the {@link Array} or {@link Stream}, an
 * execution is going to be made.
 * @param {Object} [options] The execution options.
 * @param {String} [options.executionProfile] The execution profile to be used.
 * @param {Number} [options.concurrencyLevel=100] The concurrency level to determine the maximum amount of in-flight
 * operations at any given time
 * @param {Boolean} [options.raiseOnFirstError=true] Determines whether execution should stop after the first failed
 * execution and the corresponding exception will be raised.
 * @param {Boolean} [options.collectResults=false] Determines whether each individual
 * [ResultSet]{@link module:types~ResultSet} instance should be collected in the grouped result.
 * @param {Number} [options.maxErrors=100] The maximum amount of errors to be collected before ignoring the rest of
 * the error results.
 * @returns {Promise<ResultSetGroup>} A `Promise` of {@link ResultSetGroup} that is resolved when all the
 * executions completed and it's rejected when `raiseOnFirstError` is `true` and there is one
 * or more failures.
 * @example <caption>Using a fixed query and an Array of Arrays as parameters</caption>
 * const query = 'INSERT INTO table1 (id, value) VALUES (?, ?)';
 * const parameters = [[1, 'a'], [2, 'b'], [3, 'c'], ]; // ...
 * const result = await executeConcurrent(client, query, parameters);
 * @example <caption>Using a fixed query and a readable stream</caption>
 * const stream = csvStream.pipe(transformLineToArrayStream);
 * const result = await executeConcurrent(client, query, stream);
 * @example <caption>Using a different queries</caption>
 * const queryAndParameters = [
 *   { query: 'INSERT INTO videos (id, name, user_id) VALUES (?, ?, ?)',
 *     params: [ id, name, userId ] },
 *   { query: 'INSERT INTO user_videos (user_id, id, name) VALUES (?, ?, ?)',
 *     params: [ userId, id, name ] },
 *   { query: 'INSERT INTO latest_videos (id, name, user_id) VALUES (?, ?, ?)',
 *     params: [ id, name, userId ] },
 * ];
 *
 * const result = await executeConcurrent(client, queryAndParameters);
 */
function executeConcurrent(client, query, parameters, options) {
    if (!client) {
        throw new TypeError("Client instance is not defined");
    }

    if (typeof query === "string") {
        if (Array.isArray(parameters)) {
            return new ArrayBasedExecutor(
                client,
                query,
                parameters,
                options,
            ).execute();
        }

        if (parameters instanceof Stream) {
            return new StreamBasedExecutor(
                client,
                query,
                parameters,
                options,
            ).execute();
        }

        throw new TypeError(
            "parameters should be an Array or a Stream instance",
        );
    }

    if (Array.isArray(query)) {
        options = parameters;
        return new ArrayBasedExecutor(client, null, query, options).execute();
    }

    throw new TypeError(
        "A string query or query and parameters array should be provided",
    );
}

/**
 * Wraps the functionality to execute given an Array.
 * @ignore
 */
class ArrayBasedExecutor {
    #client;
    #query;
    #parameters;
    #raiseOnFirstError;
    #concurrencyLevel;
    #queryOptions;
    #result;
    #stop;
    #cache;

    /**
     * @param {_Client} client
     * @param {String} query
     * @param {Array<Array<any>>|Array<{query, params}>} parameters
     * @param {Object} [options] The execution options.
     * @private
     */
    constructor(client, query, parameters, options) {
        this.#client = client;
        this.#query = query;
        this.#parameters = parameters;
        options = options || utils.emptyObject;
        this.#raiseOnFirstError = options.raiseOnFirstError !== false;
        this.#concurrencyLevel = Math.min(
            options.concurrencyLevel || 100,
            this.#parameters.length,
        );
        // Create ExecutionOptions here, to avoid creation of new
        // rust QueryOptionsWrapper for each of the executed queries.
        this.#queryOptions = client.createOptions({
            prepare: true,
            executionProfile: options.executionProfile,
        });
        this.#result = new ResultSetGroup(options);
        this.#stop = false;
        this.#cache = new PreparedCache();
    }

    async execute() {
        const promises = new Array(this.#concurrencyLevel);

        for (let i = 0; i < this.#concurrencyLevel; i++) {
            promises[i] = this.#executeOneAtATime(i, 0);
        }

        await Promise.all(promises);
        return this.#result;
    }

    async #executeOneAtATime(initialIndex, iteration) {
        const index = initialIndex + this.#concurrencyLevel * iteration;

        if (index >= this.#parameters.length || this.#stop) {
            return Promise.resolve();
        }

        const item = this.#parameters[index];
        let query;
        let params;

        if (this.#query === null) {
            query = item.query;
            params = item.params;
        } else {
            query = this.#query;
            params = item;
        }

        try {
            let prepared = this.#cache.getElement(query);
            if (!prepared) {
                prepared = await (this.#client.prepareStatement(query));
                this.#cache.storeElement(query, prepared);
            }
            await this.#client
                .rustyExecute(prepared, params || [], this.#queryOptions)
                .then((rs) => this.#result.setResultItem(index, rs));
        } catch (err) {
            this.#setError(index, err);
        }
        return this.#executeOneAtATime(initialIndex, iteration + 1);
    }

    #setError(index, err) {
        this.#result.setError(index, err);

        if (this.#raiseOnFirstError) {
            this.#stop = true;
            throw err;
        }
    }
}

/**
 * Wraps the functionality to execute given a Stream.
 * @ignore
 */
class StreamBasedExecutor {
    #client;
    #query;
    #stream;
    #raiseOnFirstError;
    #concurrencyLevel;
    #queryOptions;
    #inFlight;
    #index;
    #result;
    #resolveCallback;
    #rejectCallback;
    #readEnded;

    /**
     * @param {_Client} client
     * @param {String} query
     * @param {Stream} stream
     * @param {Object} [options] The execution options.
     * @private
     */
    constructor(client, query, stream, options) {
        this.#client = client;
        this.#query = query;
        this.#stream = stream;
        options = options || utils.emptyObject;
        this.#raiseOnFirstError = options.raiseOnFirstError !== false;
        this.#concurrencyLevel = options.concurrencyLevel || 100;
        // Create ExecutionOptions here, to avoid creation of new 
        // rust QueryOptionsWrapper for each of the executed queries.
        this.#queryOptions = client.createOptions({
            prepare: true,
            executionProfile: options.executionProfile,
        });
        this.#inFlight = 0;
        this.#index = 0;
        this.#result = new ResultSetGroup(options);
        this.#resolveCallback = null;
        this.#rejectCallback = null;
        this.#readEnded = false;
    }

    execute() {
        return new Promise((resolve, reject) => {
            this.#resolveCallback = resolve;
            this.#rejectCallback = reject;

            this.#stream
                .on("data", (params) => this.#executeOne(params))
                .on("error", (err) => this.#setReadEnded(err))
                .on("end", () => this.#setReadEnded());
        });
    }

    async #executeOne(params) {
        if (!Array.isArray(params)) {
            return this.#setReadEnded(
                new TypeError(
                    "Stream should be in objectMode and should emit Array instances",
                ),
            );
        }

        if (this.#readEnded) {
            // Read ended abruptly because of incorrect format or error event being emitted.
            // We shouldn't consider additional items.
            return;
        }

        this.#inFlight++;
        const index = this.#index++;

        this.#client
            .execute(this.#query, params, this.#queryOptions)
            .then((rs) => {
                this.#result.setResultItem(index, rs);
                this.#inFlight--;
            })
            .catch((err) => {
                this.#inFlight--;
                this.#setError(index, err);
            })
            .then(() => {
                if (this.#stream.isPaused()) {
                    this.#stream.resume();
                }

                if (this.#readEnded && this.#inFlight === 0) {
                    // When read ended and there are no more in-flight requests
                    // We yield the result to the user.
                    // It could have ended prematurely when there is a read error
                    // or there was an execution error and raiseOnFirstError is true
                    // In that case, calling the resolve callback has no effect
                    this.#resolveCallback(this.#result);
                }
            });

        if (this.#inFlight >= this.#concurrencyLevel) {
            this.#stream.pause();
        }
    }

    /**
     * Marks the stream read process as ended.
     * @param {Error} [err] The stream read error.
     * @private
     */
    #setReadEnded(err) {
        if (!this.#readEnded) {
            this.#readEnded = true;

            if (err) {
                // There was an error while reading from the input stream.
                // This should be surfaced as a failure
                this.#rejectCallback(err);
            } else if (this.#inFlight === 0) {
                // Ended signaled and there are no more pending messages.
                this.#resolveCallback(this.#result);
            }
        }
    }

    #setError(index, err) {
        this.#result.setError(index, err);

        if (this.#raiseOnFirstError) {
            this.#readEnded = true;
            this.#rejectCallback(err);
        }
    }
}

/**
 * Represents results from different related executions.
 */
class ResultSetGroup {
    #collectResults;
    #maxErrors;

    /**
     * Creates a new instance of {@link ResultSetGroup}.
     * @ignore
     */
    constructor(options) {
        this.#collectResults = options.collectResults;
        this.#maxErrors = options.maxErrors || 100;
        this.totalExecuted = 0;
        this.errors = [];

        if (this.#collectResults) {
            /**
             * Gets an {@link Array} containing the [ResultSet]{@link module:types~ResultSet} instances from each execution.
             *
             * Note that when `collectResults` is set to `false`, accessing this property will
             * throw an error.
             * @type {Array<any>}
             */
            this.resultItems = [];
        } else {
            Object.defineProperty(this, "resultItems", {
                enumerable: false,
                get: () => {
                    throw new Error(
                        "Property resultItems can not be accessed when collectResults is set to false",
                    );
                },
            });
        }
    }

    /** @ignore */
    setResultItem(index, rs) {
        this.totalExecuted++;

        if (this.#collectResults) {
            this.resultItems[index] = rs;
        }
    }

    /**
     * Internal method to set the error of an execution.
     * @ignore
     */
    setError(index, err) {
        this.totalExecuted++;

        if (this.errors.length < this.#maxErrors) {
            this.errors.push(err);
        }

        if (this.#collectResults) {
            this.resultItems[index] = err;
        }
    }
}

exports.executeConcurrent = executeConcurrent;
exports.ResultSetGroup = ResultSetGroup;
