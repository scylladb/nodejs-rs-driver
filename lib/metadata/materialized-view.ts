"use strict";

import { ColumnMetadata, TableMetadata } from "./table-metadata";
import rust = require("../../index");

/**
 * Describes a CQL materialized view.
 * @alias module:metadata~MaterializedView
 * @extends TableMetadata
 */
class MaterializedView extends TableMetadata {
    /**
     * Name of the table.
     */
    readonly tableName: string;

    /**
     * Constructs a MaterializedView instance.
     *
     * Instances of this class are constructed directly from the native code when reading cluster metadata.
     * @param {Record<string, ColumnMetadata>} columns Columns of the view, keyed by name.
     * @param {string[]} partitionKey Names of the view's partition key columns.
     * @param {string[]} clusteringKey Names of the view's clustering key columns.
     * @param {string | null} partitioner Partitioner of the view, if it overrides the default.
     * @param {string} tableName Name of the table the view is built from.
     * @internal
     * @ignore
     */
    constructor(
        columns: Record<string, ColumnMetadata>,
        partitionKey: string[],
        clusteringKey: string[],
        partitioner: string | null,
        tableName: string,
    ) {
        super(columns, partitionKey, clusteringKey, partitioner);
        this.tableName = tableName;
    }
}

export { MaterializedView };

// Registers the MaterializedView constructor, so that Rust can construct
// fully-formed instances directly when reading cluster metadata.
rust.registerMaterializedViewCtor(MaterializedView);
