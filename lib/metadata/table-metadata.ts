"use strict";

import { ColumnInfo } from "../types/cql-utils";

/**
 * Some columns have a specific meaning in the context of a table,
 * and this meaning is represented by the {@link ColumnKind} enum.
 * @alias module:metadata~ColumnKind
 */
enum ColumnKind {
    /** Just a regular column. */
    Regular = 0,
    /** Column that has the same value for all rows in a partition. */
    Static = 1,
    /** Column that is part of the clustering key. */
    ClusteringKey = 2,
    /** Column that is part of the partition key. */
    PartitionKey = 3,
}

/**
 * Describes a column of the table.
 * @alias module:metadata~ColumnMetadata
 */
class ColumnMetadata {
    /**
     * CQL type that the value stored in this column has.
     */
    type: ColumnInfo;

    /**
     * Describes role of the column in the table.
     */
    kind: ColumnKind;

    /**
     * @internal
     * @ignore
     */
    constructor(typ: ColumnInfo, kind: ColumnKind) {
        this.type = typ;
        this.kind = kind;
    }
}

/**
 * Describes a table in the cluster.
 * @alias module:metadata~TableMetadata
 */
class TableMetadata {
    /**
     * Columns that constitute the table, keyed by column name.
     *
     * This type does not contain information about the order of the columns in the table.
     */
    columns: Record<string, ColumnMetadata>;

    /**
     * Names of the columns that constitute the partition key.
     * All names are guaranteed to be present in {@link columns}.
     */
    partitionKey: string[];

    /**
     * Names of the columns that constitute the clustering key.
     * All names are guaranteed to be present in {@link columns}.
     */
    clusteringKey: string[];

    /**
     * Name of the partitioner used by the table, or null if not set.
     */
    partitioner: string | null;

    /**
     * @internal
     * @ignore
     */
    constructor(
        columns: Record<string, ColumnMetadata>,
        partitionKey: string[],
        clusteringKey: string[],
        partitioner: string | null,
    ) {
        this.columns = columns;
        this.partitionKey = partitionKey;
        this.clusteringKey = clusteringKey;
        this.partitioner = partitioner;
    }
}

export { TableMetadata, ColumnMetadata, ColumnKind };
