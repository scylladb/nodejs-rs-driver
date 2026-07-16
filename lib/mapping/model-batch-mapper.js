// @ts-nocheck
"use strict";

const Tree = require("./tree");
const moduleBatchItemModule = require("./model-batch-item");
const InsertModelBatchItem = moduleBatchItemModule.InsertModelBatchItem;
const UpdateModelBatchItem = moduleBatchItemModule.UpdateModelBatchItem;
const RemoveModelBatchItem = moduleBatchItemModule.RemoveModelBatchItem;

/**
 * Provides utility methods to group multiple mutations on a single batch.
 * @alias module:mapping~ModelBatchMapper
 */
class ModelBatchMapper {
    #handler;
    #cache;

    /**
     * Creates a new instance of model batch mapper.
     *
     * An instance of this class is exposed as a singleton in the `batching` field of the
     * [ModelMapper]{@link module:mapping~ModelMapper}. Note that new instances should not be create with this
     * constructor.
     * @param {MappingHandler} handler
     * @ignore
     */
    constructor(handler) {
        this.#handler = handler;
        this.#cache = {
            insert: new Tree(),
            update: new Tree(),
            remove: new Tree(),
        };
    }

    /**
     * Gets a [ModelBatchItem]{@link module:mapping~ModelBatchItem} containing the queries for the INSERT mutation to be
     * used in a batch execution.
     * @param {Object} doc An object containing the properties to insert.
     * @param {Object} [docInfo] An object containing the additional document information.
     * @param {Array<String>} [docInfo.fields] An Array containing the name of the properties that will be used in the
     * INSERT cql statements generated. If specified, it must include the columns to insert and the primary keys.
     * @param {Number} [docInfo.ttl] Specifies an optional Time To Live (in seconds) for the inserted values.
     * @param {Boolean} [docInfo.ifNotExists] When set, it only inserts if the row does not exist prior to the insertion.
     *
     * Please note that using IF NOT EXISTS will incur a non negligible performance cost so this should be used
     * sparingly.
     * @returns {ModelBatchItem} A [ModelBatchItem]{@link module:mapping~ModelBatchItem} instance representing a query
     * or a set of queries to be included in a batch.
     */
    insert(doc, docInfo) {
        return new InsertModelBatchItem(
            doc,
            docInfo,
            this.#handler,
            this.#cache.insert,
        );
    }

    /**
     * Gets a [ModelBatchItem]{@link module:mapping~ModelBatchItem} containing the queries for the UPDATE mutation to be
     * used in a batch execution.
     * @param {Object} doc An object containing the properties to update.
     * @param {Object} [docInfo] An object containing the additional document information.
     * @param {Array<String>} [docInfo.fields] An Array containing the name of the properties that will be used in the
     * UPDATE cql statements generated. If specified, it must include the columns to update and the primary keys.
     * @param {Number} [docInfo.ttl] Specifies an optional Time To Live (in seconds) for the inserted values.
     * @param {Boolean} [docInfo.ifExists] When set, it only updates if the row already exists on the server.
     *
     * Please note that using IF conditions will incur a non negligible performance cost on the server-side so this
     * should be used sparingly.
     *
     * @param {Object} [docInfo.when] A document that act as the condition that has to be met for the UPDATE to occur.
     * Use this property only in the case you want to specify a conditional clause for lightweight transactions (CAS).
     *
     * Please note that using IF conditions will incur a non negligible performance cost on the server-side so this
     * should be used sparingly.
     *
     * @returns {ModelBatchItem} A [ModelBatchItem]{@link module:mapping~ModelBatchItem} instance representing a query
     * or a set of queries to be included in a batch.
     */
    update(doc, docInfo) {
        return new UpdateModelBatchItem(
            doc,
            docInfo,
            this.#handler,
            this.#cache.update,
        );
    }

    /**
     * Gets a [ModelBatchItem]{@link module:mapping~ModelBatchItem}  containing the queries for the DELETE mutation to be
     * used in a batch execution.
     * @param {Object} doc A document containing the primary keys values of the document to delete.
     * @param {Object} [docInfo] An object containing the additional doc information.
     * @param {Object} [docInfo.when] A document that act as the condition that has to be met for the DELETE to occur.
     * Use this property only in the case you want to specify a conditional clause for lightweight transactions (CAS).
     * When the CQL query is generated, this would be used to generate the `IF` clause.
     *
     * Please note that using IF conditions will incur a non negligible performance cost on the server-side so this
     * should be used sparingly.
     *
     * @param {Boolean} [docInfo.ifExists] When set, it only issues the DELETE command if the row already exists on the
     * server.
     *
     * Please note that using IF conditions will incur a non negligible performance cost on the server-side so this
     * should be used sparingly.
     *
     * @param {Array<String>} [docInfo.fields] An Array containing the name of the properties that will be used in the
     * DELETE cql statement generated. If specified, it must include the columns to delete and the primary keys.
     * @param {Boolean} [docInfo.deleteOnlyColumns] Determines that, when more document properties are specified
     * besides the primary keys, the generated DELETE statement should be used to delete some column values but leave
     * the row. When this is enabled and more properties are specified, a DELETE statement will have the following form:
     * "DELETE col1, col2 FROM table1 WHERE pk1 = ? AND pk2 = ?"
     * @returns {ModelBatchItem} A [ModelBatchItem]{@link module:mapping~ModelBatchItem} instance representing a query
     * or a set of queries to be included in a batch.
     */
    remove(doc, docInfo) {
        // Copilot FIXME: remove() is wiring RemoveModelBatchItem to this.#cache.update, which mixes DELETE query caching with UPDATE caching.
        // This can lead to incorrect cached query reuse because DELETE uses Cache.getRemoveKey() while UPDATE uses Cache.getUpdateKey()
        // (see lib/mapping/model-batch-item.js:185-197). The cache entry for deletes should use the dedicated remove tree.
        return new RemoveModelBatchItem(
            doc,
            docInfo,
            this.#handler,
            this.#cache.update,
        );
    }
}

module.exports = ModelBatchMapper;
