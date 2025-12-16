"use strict";

const utils = require("../utils");
const errors = require("../errors");
const rust = require("../../index");
const resultsWrapper = require("./results-wrapper");
const Uuid = require("./uuid");

const asyncIteratorSymbol = Symbol.asyncIterator || "@@asyncIterator";

/** @module types */

/**
 * Represents the result of a query.
 */

class ResultSet {
    /**
     * Object representing Rust result wrapper.
     * This value is used for the fields that are retrieved lazily.
     * @type {rust.QueryResultWrapper}
     */
    #rustResult;

    /**
     * Cache for columns vale.
     * This field is filled, only when user requests its value.
     * @type {Array.<{String, type}>?}
     */
    #columns;

    /**
     * @type {Object|null}
     */
    #infoCache;

    /**
     * @param {rust.QueryResultWrapper} result
     * @param {rust.PagingStateResponseWrapper} [pagingState]
     */
    constructor(result, pagingState) {
        // Old constructor logic only for purpose of unit tests.
        if (!(result instanceof rust.QueryResultWrapper)) {
            console.warn(
                "Using legacy version of the ResultSet constructor.\n" +
                    "This is deprecated and may be removed at any moment.",
            );

            this.rows = result.rows;
            this.rowLength = this.rows ? this.rows.length : result.rowLength;
            this.#columns = null;
            this.pageState = null;
            this.nextPage = undefined;
            this.nextPageAsync = undefined;
            const meta = result.meta;

            if (meta) {
                this.#columns = meta.columns;

                if (meta.pageState) {
                    this.pageState = meta.pageState.toString("hex");
                    Object.defineProperty(this, "rawPageState", {
                        value: meta.pageState,
                        enumerable: false,
                    });
                }
            }
            return;
        }
        /**
         * Gets an array rows returned by the query.
         * When the result set represents a response from a write query, this property will be `undefined`.
         * When the read query result contains more rows than the fetch size (5000), this property will only contain the
         * first rows up to fetch size. To obtain all the rows, you can use the built-in async iterator that will retrieve the
         * following pages of results.
         * @type {Array<Row>|undefined}
         */
        this.rows = resultsWrapper.getRowsFromResultsWrapper(result);

        /**
         * Gets the row length of the result, regardless if the result has been buffered or not
         * @type {Number|undefined}
         */
        this.rowLength = this.rows ? this.rows.length : 0;

        this.#rustResult = result;
        this.#columns = null;

        /**
         * A string token representing the current page state of query. It can be used in the following executions to
         * continue paging and retrieve the remained of the result for the query.
         * @type {String|null}
         * @default null
         */
        this.pageState = null;

        if (pagingState && pagingState.hasNextPage()) {
            this.pageState = pagingState
                .nextPage()
                .getRawPageState()
                .toString("hex");
            Object.defineProperty(this, "rawPageState", {
                value: pagingState.nextPage().getRawPageState(),
                enumerable: false,
            });
        }

        /**
         * Method used to manually fetch the next page of results.
         * This method is only exposed when using the {@link Client#eachRow} method and there are more rows available in
         * following pages.
         * @type Function
         */
        this.nextPage = undefined;

        /**
         * Method used internally to fetch the next page of results using promises.
         * @internal
         * @ignore
         * @type {Function}
         */
        this.nextPageAsync = undefined;
    }

    /**
     * Gets the columns returned in this ResultSet.
     * @type {Array.<{String, type}>}
     * @readonly
     */
    get columns() {
        if (!this.#columns) {
            this.#columns = resultsWrapper.getColumnsMetadata(this.#rustResult);
        }
        return this.#columns;
    }

    set columns(_) {
        throw new SyntaxError("ResultSet is read-only");
    }

    /**
     * Information on the execution of a successful query:
     * @member {Object}
     * @property {Number} achievedConsistency The consistency level that has been actually achieved by the query.
     * @property {String} queriedHost The Cassandra host that coordinated this query.
     * @property {Object} triedHosts Gets the associative array of host that were queried before getting a valid response,
     * being the last host the one that replied correctly.
     * @property {Object} speculativeExecutions The number of speculative executions (not including the first) executed before
     * getting a valid response.
     * @property {Uuid} traceId Identifier of the trace session.
     * @property {Array.<string>} warnings Warning messages generated by the server when executing the query.
     * @property {Boolean} isSchemaInAgreement Whether the cluster had reached schema agreement after the execution of
     * this query.
     *
     * TODO: Check if this is the case in rust driver:
     *
     * After a successful schema-altering query (ex: creating a table), the driver will check if
     * the cluster's nodes agree on the new schema version. If not, it will keep retrying for a given
     * delay (see `protocolOptions.maxSchemaAgreementWaitSeconds`).
     *
     * Note that the schema agreement check is only performed for schema-altering queries For other
     * query types, this method will always return `true`. If this method returns `false`,
     * clients can call [Metadata.checkSchemaAgreement()]{@link module:metadata~Metadata#checkSchemaAgreement} later to
     * perform the check manually.
     * @readonly
     */
    get info() {
        if (!this.#infoCache) {
            let traceId = this.#rustResult.getTraceId();
            if (traceId !== null) traceId = Uuid.fromRust(traceId);

            this.#infoCache = {
                queriedHost: undefined, // Not yet supported by rust driver: https://github.com/scylladb/scylla-rust-driver/issues/1030
                triedHosts: undefined, // FIXME: Fill this field
                speculativeExecutions: undefined, // FIXME: Fill this field: https://github.com/scylladb-zpp-2024-javascript-driver/scylladb-javascript-driver/pull/37#discussion_r1817998702
                achievedConsistency: undefined, // FIXME: Find out more about this field: https://github.com/scylladb-zpp-2024-javascript-driver/scylladb-javascript-driver/pull/37#discussion_r1818000903
                traceId: traceId,
                warnings: this.#rustResult.getWarnings(),
                customPayload: null, // Not exposed by the rust driver: https://github.com/scylladb-zpp-2024-javascript-driver/scylladb-javascript-driver/pull/37#discussion_r1817998912
                isSchemaInAgreement: false, // FIXME: Look into this field: https://github.com/scylladb-zpp-2024-javascript-driver/scylladb-javascript-driver/pull/37#discussion_r1818002641
            };
        }
        return this.#infoCache;
    }

    set info(_) {
        throw new SyntaxError("ResultSet is read-only");
    }

    /**
     * Returns the first row or null if the result rows are empty.
     */
    first() {
        if (this.rows && this.rows.length) {
            return this.rows[0];
        }
        return null;
    }

    /**
     * When this instance is the result of a conditional update query, it returns whether it was successful.
     * Otherwise, it returns `true`.
     *
     * For consistency, this method always returns `true` for non-conditional queries (although there is
     * no reason to call the method in that case). This is also the case for conditional DDL statements
     * (CREATE KEYSPACE... IF NOT EXISTS, CREATE TABLE... IF NOT EXISTS), for which the server doesn't return
     * information whether it was applied or not.
     */
    wasApplied() {
        if (!this.rows || this.rows.length === 0) {
            return true;
        }
        const firstRow = this.rows[0];
        const applied = firstRow["[applied]"];
        return typeof applied === "boolean" ? applied : true;
    }

    /**
     * Gets the iterator function.
     *
     * Retrieves the iterator of the underlying fetched rows, without causing the driver to fetch the following
     * result pages. For more information on result paging,
     * [visit the documentation]{@link http://docs.datastax.com/en/developer/nodejs-driver/latest/features/paging/}.
     * @alias module:types~ResultSet#@@iterator
     * @see {@link module:types~ResultSet#@@asyncIterator}
     * @example <caption>Using for...of statement</caption>
     * const query = 'SELECT user_id, post_id, content FROM timeline WHERE user_id = ?';
     * const result = await client.execute(query, [ id ], { prepare: true });
     * for (const row of result) {
     *   console.log(row['email']);
     * }
     * @returns {Iterator.<Row>}
     */
    [Symbol.iterator]() {
        if (!this.rows) {
            return utils.emptyArray[Symbol.iterator]();
        }
        return this.rows[Symbol.iterator]();
    }

    /**
     * Gets the async iterator function.
     *
     * Retrieves the async iterator representing the entire query result, the driver will fetch the following result
     * pages.
     *
     * Use the async iterator when the query result might contain more rows than the `fetchSize`.
     *
     * Note that using the async iterator will not affect the internal state of the `ResultSet` instance.
     * You should avoid using both `rows` property that contains the row instances of the first page of
     * results, and the async iterator, that will yield all the rows in the result regardless on the number of pages.
     *
     * Multiple concurrent async iterations are not supported.
     * @alias module:types~ResultSet#@@asyncIterator
     * @example <caption>Using for await...of statement</caption>
     * const query = 'SELECT user_id, post_id, content FROM timeline WHERE user_id = ?';
     * const result = await client.execute(query, [ id ], { prepare: true });
     * for await (const row of result) {
     *   console.log(row['email']);
     * }
     * @returns {AsyncIterator<Row>}
     */
    [asyncIteratorSymbol]() {
        let index = 0;
        let pageState = this.rawPageState;
        let rows = this.rows;

        if (!rows || rows.length === 0) {
            return { next: () => Promise.resolve({ done: true }) };
        }

        const self = this;

        // Async generators are not present in Node.js 8, implement it manually
        return {
            async next() {
                if (index >= rows.length && pageState) {
                    if (!self.nextPageAsync) {
                        throw new errors.DriverInternalError(
                            "Property nextPageAsync should be set when pageState is defined",
                        );
                    }

                    const rs = await self.nextPageAsync(pageState);
                    rows = rs.rows;
                    index = 0;
                    pageState = rs.rawPageState;
                }

                if (index < rows.length) {
                    return { done: false, value: rows[index++] };
                }

                return { done: true };
            },
        };
    }

    /**
     * Determines whether there are more pages of results.
     * If so, the driver will initially retrieve and contain only the first page of results.
     * To obtain all the rows, use the [AsyncIterator]{@linkcode module:types~ResultSet#@@asyncIterator}.
     * @returns {boolean}
     */
    isPaged() {
        return !!this.rawPageState;
    }
}

module.exports = ResultSet;
