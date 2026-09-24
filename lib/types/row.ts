"use strict";
/** @module types */

/**
 * Represents a result row
 */
class Row {
    /**
     * The value of each column of the row, keyed by column name.
     */
    [key: string]: any;

    #columns: Array<string | { name: string }>;

    /**
     * Creates Row from array of column names. Column names can be provided either as array of strings
     * or array of objects with property name representing column name. Any other metadata will be ignored
     */
    constructor(columns: Array<string | { name: string }>) {
        if (!columns) {
            throw new Error("Columns not defined");
        }
        // This field should not be modified.
        this.#columns = columns;
    }
    /**
     * Returns the cell value.
     * @param columnName Name or index of the column
     */
    get(columnName: string | number): any {
        if (typeof columnName === "number") {
            // its an index
            const column = this.#columns[columnName];
            return this[typeof column === "string" ? column : column.name];
        }
        return this[columnName];
    }
    /**
     * Returns an array of the values of the row
     */
    values(): Array<any> {
        const valuesArray: Array<any> = [];
        this.forEach(function (val) {
            valuesArray.push(val);
        });
        return valuesArray;
    }
    /**
     * Returns an array of the column names of the row
     */
    keys(): Array<string> {
        const keysArray: Array<string> = [];
        this.forEach(function (val, key) {
            keysArray.push(key);
        });
        return keysArray;
    }
    /**
     * Executes the callback for each field in the row, containing the value as first parameter followed by the columnName
     */
    forEach(callback: (val: any, columnName: string) => void): void {
        for (const columnName in this) {
            if (!Object.prototype.hasOwnProperty.call(this, columnName)) {
                continue;
            }
            callback(this[columnName], columnName);
        }
    }
}

export = Row;
