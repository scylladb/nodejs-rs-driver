// @ts-nocheck
"use strict";

const util = require("util");
const utils = require("../utils");
const inspectMethod = util.inspect.custom || "inspect";

/**
 * Represents the result of an execution as an iterable of objects in the Mapper.
 * @alias module:mapping~Result
 */
class Result {
    #rs;
    #info;
    #rowAdapter;
    #isEmptyLwt;

    /**
     * Creates a new instance of Result.
     * @param {ResultSet} rs
     * @param {ModelMappingInfo} info
     * @param {Function} rowAdapter
     */
    constructor(rs, info, rowAdapter) {
        this.#rs = rs;
        this.#info = info;
        this.#rowAdapter = rowAdapter;

        /**
         * When there is a single cell containing the result of the a LWT operation, hide the result from the user.
         * @private
         */
        this.#isEmptyLwt =
            rs.columns !== null &&
            rs.columns.length === 1 &&
            this.#rs.rowLength === 1 &&
            rs.columns[0].name === "[applied]";

        /**
         * Gets the amount of the documents contained in this Result instance.
         *
         * When the results are paged, it returns the length of the current paged results not the total amount of
         * rows in the table matching the query.
         * @type {Number}
         */
        this.length = this.#isEmptyLwt ? 0 : rs.rowLength || 0;

        /**
         * A string token representing the current page state of query.
         *
         * When provided, it can be used in the following executions to continue paging and retrieve the remained of the
         * result for the query.
         * @type {String}
         * @default null
         */
        this.pageState = rs.pageState;
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
        return this.#rs.wasApplied();
    }

    /**
     * Gets the first document in this result or null when the result is empty.
     */
    first() {
        if (!this.#rs.rowLength || this.#isEmptyLwt) {
            return null;
        }
        return this.#rowAdapter(this.#rs.rows[0], this.#info);
    }

    /**
     * Returns a new Iterator object that contains the document values.
     */
    *[Symbol.iterator]() {
        if (this.#isEmptyLwt) {
            // Empty iterator
            return;
        }

        for (let i = 0; i < this.#rs.rows.length; i++) {
            yield this.#rowAdapter(this.#rs.rows[i], this.#info);
        }
    }

    /**
     * Converts the current instance to an Array of documents.
     * @return {Array<Object>}
     */
    toArray() {
        if (this.#isEmptyLwt || !this.#rs.rows) {
            return utils.emptyArray;
        }

        return this.#rs.rows.map((row) => this.#rowAdapter(row, this.#info));
    }

    /**
     * Executes a provided function once per result element.
     * @param {Function} callback Function to execute for each element, taking two arguments: currentValue and index.
     * @param {Object} [thisArg] Value to use as `this` when executing callback.
     */
    forEach(callback, thisArg) {
        let index = 0;
        thisArg = thisArg || this;
        for (const doc of this) {
            callback.call(thisArg, doc, index++);
        }
    }

    [inspectMethod]() {
        return this.toArray();
    }
}

module.exports = Result;
