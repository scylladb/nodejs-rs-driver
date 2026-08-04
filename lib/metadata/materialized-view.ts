"use strict";

import { TableMetadata, ColumnMetadata } from "./table-metadata";
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
    tableName: string;

    /**
     * Constructs a MaterializedView instance.
     *
     * Instances of this class are constructed directly from the native code when reading cluster metadata.
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
