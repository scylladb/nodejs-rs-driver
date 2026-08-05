"use strict";

/**
 * Module containing classes and fields related to metadata.
 * @module metadata
 */

/**
 * @const
 * @private
 */
const _selectSchemaVersionPeers = "SELECT schema_version FROM system.peers";
/**
 * @const
 * @private
 */
const _selectSchemaVersionLocal = "SELECT schema_version FROM system.local";

const { KeyspaceMetadata } = require("./keyspace-metadata");
// Used for JS doc
// eslint-disable-next-line no-unused-vars
const { TableMetadata } = require("./table-metadata");
// eslint-disable-next-line no-unused-vars
const { MaterializedView } = require("./materialized-view");
// eslint-disable-next-line no-unused-vars
const { Udt } = require("./user-defined-type");
// eslint-disable-next-line no-unused-vars
const { QueryTrace } = require("./query-trace");
// eslint-disable-next-line no-unused-vars
const Uuid = require("../types/uuid");
const promiseUtils = require('../promise-utils');

/**
 * Represents cluster and schema information.
 * The metadata class acts as a internal state of the driver.
 */
class Metadata {
    #rustClient;

    /**
     * Creates a new instance of {@link Metadata}.
     * @param {RustClient} rustClient
     */
    constructor(rustClient) {
        this.#rustClient = rustClient;
    }

    /**
     * Gets the keyspace metadata by name.
     * @param {string} name Name of the keyspace.
     * @returns {KeyspaceMetadata | null} The keyspace metadata, or `null` if it does not exist.
     */
    getKeyspace(name) {
        const keyspaceWrapper = this.#rustClient.getKeyspaceWrapper(name);
        if (!keyspaceWrapper) {
            return null;
        }
        return KeyspaceMetadata.fromRust(keyspaceWrapper);
    }

    /**
     * Gets all keyspace metadata.
     * @returns {Map<string, KeyspaceMetadata>} A map of all keyspaces indexed by name.
     */
    getKeyspaces() {
        const keyspaceWrappers = this.#rustClient.getKeyspaceWrappers();
        return new Map(
            Object.entries(keyspaceWrappers).map(([name, keyspaceWrapper]) => [
                name,
                KeyspaceMetadata.fromRust(keyspaceWrapper),
            ]),
        );
    }

    /**
     * Gets the host list representing the replicas that contain the given partition key, token or token range.
     *
     * It uses the pre-loaded keyspace metadata to retrieve the replicas for a token for a given keyspace.
     * When the keyspace metadata has not been loaded, it returns null.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {Buffer | Token | TokenRange} token Can be Buffer (serialized partition key), Token or TokenRange.
     * @returns {Array<Host>}.
     */
    getReplicas(keyspaceName, token) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the token ranges that define data distribution in the ring.
     * @returns {Set<TokenRange>} The ranges of the ring or empty set if schema metadata is not enabled.
     */
    getTokenRanges() {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the token ranges that are replicated on the given host, for the given keyspace.
     * @param {string} keyspaceName The name of the keyspace to get ranges for.
     * @param {Host} host The host.
     * @returns {Set<TokenRange> | null} Ranges for the keyspace on this host or null if keyspace
     * isn't found or hasn't been loaded.
     */
    getTokenRangesForHost(keyspaceName, host) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Constructs a Token from the input buffer(s) or string input. If a string is passed in
     * it is assumed this matches the token representation reported by cassandra.
     * @param {Array<Buffer> | Buffer | string} components The token components.
     * @returns {Token} constructed token from the input buffer.
     */
    newToken(components) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Constructs a TokenRange from the given start and end tokens.
     * @param {Token} start The start token.
     * @param {Token} end The end token.
     * @returns {TokenRange} build range spanning from start (exclusive) to end (inclusive).
     */
    newTokenRange(start, end) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of an user-defined type.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the UDT.
     * @returns {Udt | null} The UDT definition, or `null` if it does not exist.
     */
    getUdt(keyspaceName, name) {
        return this.#rustClient.getUdt(keyspaceName, name);
    }

    /**
     * Gets the definition of a table.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the Table.
     * @returns {TableMetadata | null} The table metadata, or `null` if it does not exist.
     */
    getTable(keyspaceName, name) {
        return this.#rustClient.getTable(keyspaceName, name);
    }

    /**
     * Gets the definition of CQL functions for a given name.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the Function.
     * @returns {Array<SchemaFunction>} An array of schema function metadata.
     */
    getFunctions(keyspaceName, name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets a definition of CQL function for a given name and signature.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the Function.
     * @param {Array<string> | Array<{code, info}>} signature Array of types of the parameters.
     * @returns {SchemaFunction | null} The schema function metadata, or `null` if it does not exist.
     */
    getFunction(keyspaceName, name, signature) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of CQL aggregate for a given name.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the aggregate.
     * @returns {Array<Aggregate>} An array of schema aggregate metadata.
     */
    getAggregates(keyspaceName, name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets a definition of CQL aggregate for a given name and signature.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the aggregate.
     * @param {Array<string> | Array<{code, info}>} signature Array of types of the parameters.
     * @returns {Aggregate | null} The schema aggregate metadata, or `null` if it does not exist.
     */
    getAggregate(keyspaceName, name, signature) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of a CQL materialized view for a given name.
     * @param {string} keyspaceName Name of the keyspace
     * @param {string} name Name of the materialized view
     * @returns {MaterializedView | null} The materialized view definition, or `null` if it does not exist.
     */
    getMaterializedView(keyspaceName, name) {
        return this.#rustClient.getMaterializedView(keyspaceName, name);
    }

    /**
     * Gets the trace session generated by Cassandra when query tracing is enabled for the
     * query. The trace itself is stored in Cassandra in the `sessions` and
     * `events` table in the `system_traces` keyspace and can be
     * retrieve manually using the trace identifier.
     *
     * Note: the `consistency` parameter is accepted for API compatibility but is currently not
     * supported - the underlying Rust driver always uses the consistency level configured for
     * tracing queries at the session level.
     * @param {Uuid} traceId Identifier of the trace session.
     * @param {Number} [consistency] The consistency level to obtain the trace.
     * @returns {Promise<QueryTrace>}
     */
    getTrace(traceId, consistency, callback) {
        if (!callback && typeof consistency === 'function') {
          // Both callback and consistency are optional parameters
          // In this case, the second parameter is the callback
          callback = consistency;
          // eslint-disable-next-line no-useless-assignment
          consistency = null;
        }

        return promiseUtils.optionalCallback(this.#rustClient.getTracingInfo(traceId.buffer), callback);
    }

    /**
     * Checks whether hosts that are currently up agree on the schema definition.
     *
     * This method performs a one-time check only, without any form of retry; therefore
     * `protocolOptions.maxSchemaAgreementWaitSeconds` setting does not apply in this case.
     * @returns {Boolean} `true` when all hosts agree on the schema and `false` when there is no agreement or when
     * the check could not be performed (for example, if the control connection is down).
     */
    checkSchemaAgreement() {
        throw new Error("TODO: Not implemented");
    }
}

module.exports = Metadata;
