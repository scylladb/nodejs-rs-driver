"use strict";
const { TableMetadata } = require("./table-metadata");
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
}

module.exports = MaterializedView;
