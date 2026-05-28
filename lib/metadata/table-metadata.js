// @ts-nocheck
"use strict";

// Used for JS doc
// eslint-disable-next-line no-unused-vars
const { ColumnInfo } = require("../types/cql-utils");

/**
 * Some columns have a specific meaning in the context of a table,
 * and this meaning is represented by the {@link ColumnKind} enum.
 * @readonly
 * @enum {number}
 * @alias module:metadata~ColumnKind
 */
const ColumnKind = {
    /** Just a regular column. */
    Regular: 0,
    /** Column that has the same value for all rows in a partition. */
    Static: 1,
    /** Column that is part of the clustering key. */
    ClusteringKey: 2,
    /** Column that is part of the partition key. */
    PartitionKey: 3,
};

/**
 * Describes a column of the table.
 * @alias module:metadata~ColumnMetadata
 */
class ColumnMetadata {
    /**
     * CQL type that the value stored in this column has.
     * @type {ColumnInfo}
     */
    type;

    /**
     * Describes role of the column in the table.
     * @type {ColumnKind}
     */
    kind;
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
     * @type {Object.<String, ColumnMetadata>}
     */
    columns;

    /**
     * Names of the columns that constitute the partition key.
     * All names are guaranteed to be present in {@link columns}.
     * @type {Array.<String>}
     */
    partitionKey;

    /**
     * Names of the columns that constitute the clustering key.
     * All names are guaranteed to be present in {@link columns}.
     * @type {Array.<String>}
     */
    clusteringKey;

    /**
     * Name of the partitioner used by the table, or null if not set.
     * @type {String|null}
     */
    partitioner;
}

module.exports.TableMetadata = TableMetadata;
module.exports.ColumnMetadata = ColumnMetadata;
module.exports.ColumnKind = ColumnKind;
