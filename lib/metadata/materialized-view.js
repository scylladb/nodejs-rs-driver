// @ts-nocheck
"use strict";

// Used for JS doc
// eslint-disable-next-line no-unused-vars
const { TableMetadata, ColumnMetadata } = require("./table-metadata");
const _rust = require("../../index");

/**
 * Describes a CQL materialized view.
 * @alias module:metadata~MaterializedView
 * @extends TableMetadata
 */
class MaterializedView extends TableMetadata {
    /**
     * Name of the table.
     * @type {String}
     */
    tableName;

    /**
     * Constructs a MaterializedView instance.
     *
     * Instances of this class are constructed directly by the native driver when reading cluster metadata.
     * @param {Array<Array<(String|ColumnMetadata)>>} columns
     * @param {Array.<String>} partitionKey
     * @param {Array.<String>} clusteringKey
     * @param {String|null} partitioner
     * @param {String} tableName
     * @internal
     * @ignore
     */
    constructor(columns, partitionKey, clusteringKey, partitioner, tableName) {
        super(columns, partitionKey, clusteringKey, partitioner);
        this.tableName = tableName;
    }
}

module.exports.MaterializedView = MaterializedView;

// Registers the MaterializedView constructor with the native driver, so that Rust can
// construct fully-formed instances directly when reading cluster metadata.
_rust.registerMaterializedViewCtor(MaterializedView);
