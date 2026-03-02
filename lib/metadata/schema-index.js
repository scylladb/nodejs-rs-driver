"use strict";
const util = require("util");
const utils = require("../utils");
const types = require("../types");

/** @private */
const kind = {
    custom: 0,
    keys: 1,
    composites: 2,
};
/**
 * Describes a CQL index.
 * @alias module:metadata~Index
 */
class Index {
    /**
     * Creates a new Index instance.
     * @param {String} name
     * @param {String} target
     * @param {Number|String} kind
     * @param {Object} options
     */
    constructor(name, target, kind, options) {
        /**
         * Name of the index.
         * @type {String}
         */
        this.name = name;
        /**
         * Target of the index.
         * @type {String}
         */
        this.target = target;
        /**
         * A numeric value representing index kind (0: custom, 1: keys, 2: composite);
         * @type {Number}
         */
        this.kind = typeof kind === "string" ? getKindByName(kind) : kind;
        /**
         * An associative array containing the index options
         * @type {Object}
         */
        this.options = options;
    }
    /**
     * Parses Index information from rows in the 'system_schema.indexes' table
     * @deprecated It will be removed in the next major version.
     * @param {Array.<Row>} indexRows
     * @returns {Array.<Index>}
     */
    static fromRows(indexRows) {
        if (!indexRows || indexRows.length === 0) {
            return utils.emptyArray;
        }
        return indexRows.map(function (row) {
            const options = row["options"];
            return new Index(
                row["index_name"],
                options["target"],
                getKindByName(row["kind"]),
                options,
            );
        });
    }
    /**
     * Parses Index information from rows in the legacy 'system.schema_columns' table.
     * @deprecated It will be removed in the next major version.
     * @param {Array.<Row>} columnRows
     * @param {Object.<String, {name, type}>} columnsByName
     * @returns {Array.<Index>}
     */
    static fromColumnRows(columnRows, columnsByName) {
        const result = [];
        for (let i = 0; i < columnRows.length; i++) {
            const row = columnRows[i];
            const indexName = row["index_name"];
            if (!indexName) {
                continue;
            }
            const c = columnsByName[row["column_name"]];
            let target;
            const options = JSON.parse(row["index_options"]);
            if (options !== null && options["index_keys"] !== undefined) {
                target = util.format("keys(%s)", c.name);
            } else if (
                options !== null &&
                options["index_keys_and_values"] !== undefined
            ) {
                target = util.format("entries(%s)", c.name);
            } else if (
                c.type.options.frozen &&
                (c.type.code === types.dataTypes.map ||
                    c.type.code === types.dataTypes.list ||
                    c.type.code === types.dataTypes.set)
            ) {
                target = util.format("full(%s)", c.name);
            } else {
                target = c.name;
            }
            result.push(
                new Index(
                    indexName,
                    target,
                    getKindByName(row["index_type"]),
                    options,
                ),
            );
        }
        return result;
    }
    /**
     * Determines if the index is of composites kind
     * @returns {Boolean}
     */
    isCompositesKind() {
        return this.kind === kind.composites;
    }
    /**
     * Determines if the index is of keys kind
     * @returns {Boolean}
     */
    isKeysKind() {
        return this.kind === kind.keys;
    }
    /**
     * Determines if the index is of custom kind
     * @returns {Boolean}
     */
    isCustomKind() {
        return this.kind === kind.custom;
    }
}

/**
 * Gets the number representing the kind based on the name
 * @param {String} name
 * @returns {Number}
 * @private
 */
function getKindByName(name) {
    if (!name) {
        return kind.custom;
    }
    return kind[name.toLowerCase()];
}

module.exports = Index;
