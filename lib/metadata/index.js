"use strict";

/**
 * Module containing classes and fields related to metadata.
 * @module metadata
 */

/**
 * @const
 * @private
 */
const _selectTraceSession =
    "SELECT * FROM system_traces.sessions WHERE session_id=%s";
/**
 * @const
 * @private
 */
const _selectTraceEvents =
    "SELECT * FROM system_traces.events WHERE session_id=%s";
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
/**
 * @const
 * @private
 */
const _traceMaxAttemps = 5;
/**
 * @const
 * @private
 */
const _traceAttemptDelay = 400;

/**
 * Represents cluster and schema information.
 * The metadata class acts as a internal state of the driver.
 */
class Metadata {
    /**
     * Creates a new instance of {@link Metadata}.
     * @param {ClientOptions} options
     * @param {ControlConnection} controlConnection Control connection used to retrieve information.
     */
    constructor(options, controlConnection) {
    }

    /**
     * Gets the keyspace metadata information and updates the internal state of the driver.
     * @param {String} name Name of the keyspace.
     */
    refreshKeyspace(name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the metadata information of all the keyspaces and updates the internal state of the driver.
     * @param {Boolean} [waitReconnect] Determines if it should wait for reconnection in case the control connection is not
     * connected at the moment. Default: true.
     */
    refreshKeyspaces(waitReconnect) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the host list representing the replicas that contain the given partition key, token or token range.
     * 
     * It uses the pre-loaded keyspace metadata to retrieve the replicas for a token for a given keyspace.
     * When the keyspace metadata has not been loaded, it returns null.
     * @param {String} keyspaceName
     * @param {Buffer|Token|TokenRange} token Can be Buffer (serialized partition key), Token or TokenRange
     * @returns {Array}
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
     * Gets the token ranges that are replicated on the given host, for
     * the given keyspace.
     * @param {String} keyspaceName The name of the keyspace to get ranges for.
     * @param {Host} host The host.
     * @returns {Set<TokenRange>|null} Ranges for the keyspace on this host or null if keyspace isn't found or hasn't been loaded.
     */
    getTokenRangesForHost(keyspaceName, host) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Constructs a Token from the input buffer(s) or string input.  If a string is passed in
     * it is assumed this matches the token representation reported by cassandra.
     * @param {Array<Buffer>|Buffer|String} components
     * @returns {Token} constructed token from the input buffer.
     */
    newToken(components) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Constructs a TokenRange from the given start and end tokens.
     * @param {Token} start
     * @param {Token} end
     * @returns TokenRange build range spanning from start (exclusive) to end (inclusive).
     */
    newTokenRange(start, end) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Clears the internal state related to the prepared statements.
     * Following calls to the Client using the prepare flag will re-prepare the statements.
     */
    clearPrepared() {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of an user-defined type.
     * @param {String} keyspaceName Name of the keyspace.
     * @param {String} name Name of the UDT.
     */
    getUdt(keyspaceName, name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of a table.
     * @param {String} keyspaceName Name of the keyspace.
     * @param {String} name Name of the Table.
     */
    getTable(keyspaceName, name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of CQL functions for a given name.
     * @param {String} keyspaceName Name of the keyspace.
     * @param {String} name Name of the Function.
     */
    getFunctions(keyspaceName, name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets a definition of CQL function for a given name and signature.
     * @param {String} keyspaceName Name of the keyspace
     * @param {String} name Name of the Function
     * @param {Array.<String>|Array.<{code, info}>} signature Array of types of the parameters.
     */
    getFunction(keyspaceName, name, signature) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of CQL aggregate for a given name.
     * @param {String} keyspaceName Name of the keyspace
     * @param {String} name Name of the aggregate
     */
    getAggregates(keyspaceName, name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets a definition of CQL aggregate for a given name and signature.
     * @param {String} keyspaceName Name of the keyspace
     * @param {String} name Name of the aggregate
     * @param {Array.<String>|Array.<{code, info}>} signature Array of types of the parameters.
     */
    getAggregate(keyspaceName, name, signature) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of a CQL materialized view for a given name.
     *
     * Note that, unlike the rest of the {@link Metadata} methods, this method does not cache the result for following
     * calls, as the current version of the Cassandra native protocol does not support schema change events for
     * materialized views. Each call to this method will produce one or more queries to the cluster.
     * @param {String} keyspaceName Name of the keyspace
     * @param {String} name Name of the materialized view
     */
    getMaterializedView(keyspaceName, name) {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the trace session generated by Cassandra when query tracing is enabled for the
     * query. The trace itself is stored in Cassandra in the `sessions` and
     * `events` table in the `system_traces` keyspace and can be
     * retrieve manually using the trace identifier.
     * @param {Uuid} traceId Identifier of the trace session.
     * @param {Number} [consistency] The consistency level to obtain the trace.
     */
    getTrace(traceId, consistency) {
        throw new Error("TODO: Not implemented");
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
