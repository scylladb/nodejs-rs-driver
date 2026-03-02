"use strict";

const util = require("util");
const DataCollection = require("./data-collection");
/**
 * Describes a table
 * @augments {module:metadata~DataCollection}
 * @alias module:metadata~TableMetadata
 */
class TableMetadata {
    /**
     * Creates a new instance of TableMetadata
     * @param {String} name Name of the Table
     */
    constructor(name) {
        DataCollection.call(this, name);
        /**
         * Applies only to counter tables.
         * When set to true, replicates writes to all affected replicas regardless of the consistency level specified by
         * the client for a write request. For counter tables, this should always be set to true.
         * @type {Boolean}
         */
        this.replicateOnWrite = true;
        /**
         * Returns the memtable flush period (in milliseconds) option for this table.
         * @type {Number}
         */
        this.memtableFlushPeriod = 0;
        /**
         * Returns the index interval option for this table.
         *
         * Note: this option is only available in Apache Cassandra 2.0. It is deprecated in Apache Cassandra 2.1 and
         * above, and will therefore return `null` for 2.1 nodes.
         * @type {Number|null}
         */
        this.indexInterval = null;
        /**
         * Determines  whether the table uses the COMPACT STORAGE option.
         * @type {Boolean}
         */
        this.isCompact = false;
        /**
         *
         * @type {Array.<Index>}
         */
        this.indexes = null;

        /**
         * Determines whether the Change Data Capture (CDC) flag is set for the table.
         * @type {Boolean|null}
         */
        this.cdc = null;

        /**
         * Determines whether the table is a virtual table or not.
         * @type {Boolean}
         */
        this.virtual = false;
    }
}

util.inherits(TableMetadata, DataCollection);

module.exports = TableMetadata;
