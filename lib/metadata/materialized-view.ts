"use strict";

import { TableMetadata, ColumnMetadata } from "./table-metadata";

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
