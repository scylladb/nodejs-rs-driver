"use strict";
const DataCollection = require("./data-collection");
/**
 * Describes a CQL materialized view.
 * @alias module:metadata~MaterializedView
 * @augments {module:metadata~DataCollection}
 */
class MaterializedView extends DataCollection {
    /**
     * Creates a new MaterializedView.
     * @param {String} name Name of the View.
     */
    constructor(name) {
        super(name);
        /**
         * Name of the table.
         * @type {String}
         */
        this.tableName = null;
        /**
         * View where clause.
         * @type {String}
         */
        this.whereClause = null;
        /**
         * Determines if all the table columns where are included in the view.
         * @type {boolean}
         */
        this.includeAllColumns = false;
    }
}

module.exports = MaterializedView;
