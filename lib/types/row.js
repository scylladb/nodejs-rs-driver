// @ts-nocheck
"use strict";
/** @module types */

/**
 * Represents a result row
 */
class Row {
    /**
     * Creates Row from array of column names. Column names can be provided either as array of strings
     * or array of objects with property name representing column name. Any other metadata will be ignored
     * @param {Array<string | {name: string}>} columns
     */
    constructor(columns) {
        if (!columns) {
            throw new Error("Columns not defined");
        }
        // Private non-enumerable properties, with double underscore to avoid interfering with column names
        Object.defineProperty(this, "__columns", {
            value: columns,
            enumerable: false,
            writable: false,
        });
    }
    /**
     * Returns the cell value.
     * @param {String|Number} columnName Name or index of the column
     */
    get(columnName) {
        if (typeof columnName === "number") {
            // its an index
            columnName = this.__columns[columnName];
            if (typeof columnName.name == "string") {
                columnName = columnName.name;
            }
            return this[columnName];
        }
        return this[columnName];
    }
    /**
     * Returns an array of the values of the row
     * @returns {Array}
     */
    values() {
        const valuesArray = [];
        this.forEach(function (val) {
            valuesArray.push(val);
        });
        return valuesArray;
    }
    /**
     * Returns an array of the column names of the row
     * @returns {Array}
     */
    keys() {
        const keysArray = [];
        this.forEach(function (val, key) {
            keysArray.push(key);
        });
        return keysArray;
    }
    /**
     * Executes the callback for each field in the row, containing the value as first parameter followed by the columnName
     * @param {Function} callback
     */
    forEach(callback) {
        for (const columnName in this) {
            if (!Object.prototype.hasOwnProperty.call(this, columnName)) {
                continue;
            }
            callback(this[columnName], columnName);
        }
    }
}

module.exports = Row;
