// @ts-nocheck
"use strict";

// Used for JS doc
// eslint-disable-next-line no-unused-vars
const { ColumnInfo, convertComplexType } = require("../types/cql-utils");
const _rust = require("../../index");

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

    /**
     * Constructs a ColumnMetadata instance.
     *
     * Instances of this class are constructed directly by the native driver when reading cluster metadata.
     * @param {_rust.ComplexType} typ
     * @param {ColumnKind} kind
     * @internal
     * @ignore
     */
    constructor(typ, kind) {
        this.type = convertComplexType(typ);
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

    /**
     * Constructs a TableMetadata instance.
     *
     * Instances of this class are constructed directly by the native driver when reading cluster metadata.
     * @param {Array<Array<(String|ColumnMetadata)>>} columns
     * @param {Array.<String>} partitionKey
     * @param {Array.<String>} clusteringKey
     * @param {String|null} partitioner
     * @internal
     * @ignore
     */
    constructor(columns, partitionKey, clusteringKey, partitioner) {
        let columnsByName = {};
        for (let [name, columnMetadata] of columns) {
            columnsByName[name] = columnMetadata;
        }
        this.columns = columnsByName;
        this.partitionKey = partitionKey;
        this.clusteringKey = clusteringKey;
        this.partitioner = partitioner;
    }
}

module.exports.TableMetadata = TableMetadata;
module.exports.ColumnMetadata = ColumnMetadata;
module.exports.ColumnKind = ColumnKind;

// Registers the ColumnMetadata/TableMetadata constructors with the native driver, so that
// Rust can construct fully-formed instances directly when reading cluster metadata, instead
// of handing JS a plain data object to convert.
_rust.registerColumnMetadataCtor(ColumnMetadata);
_rust.registerTableMetadataCtor(TableMetadata);
