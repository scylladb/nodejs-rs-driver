"use strict";

// Imports for the purpose of type hints in JS docs.
// eslint-disable-next-line no-unused-vars
const { TableMetadata } = require("./table-metadata");
/**
 * Describes a CQL materialized view.
 * @alias module:metadata~MaterializedView
 * @extends TableMetadata
 */
class MaterializedView {
    /**
     * As materialized views are a special kind of table,
     * they have the same metadata as a table.
     * @type {TableMetadata}
     */
    viewMetadata;

    /**
     * Name of the table.
     * @type {String}
     */
    tableName;
}

module.exports.MaterializedView = MaterializedView;
