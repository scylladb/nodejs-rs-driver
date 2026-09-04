"use strict";

/**
 * Module containing classes and fields related to metadata.
 * @module metadata
 */

import { EmptyCallback, ValueCallback } from "../..";
// TODO: remove once `lib/promise-utils.js` is converted to typescript.
// @ts-ignore
import promiseUtils = require("../promise-utils");
import { Token, TokenRange, minTokenRange } from "../token";
import { Host } from "../host";
import types = require("../types");
import { ColumnInfo } from "../types/cql-utils";

import { Udt } from "./user-defined-type";
import { TableMetadata } from "./table-metadata";
import { MaterializedView } from "./materialized-view";
import { KeyspaceMetadata } from "../../index";
import { SchemaFunction } from "./schema-function";
import { Aggregate } from "./aggregate";
import { QueryTrace } from "./query-trace";
import ClientState = require("./client-state");
import { SessionWrapper as RustClient } from "../../index";

export { QueryTrace, TracingEvent } from "./query-trace";
export { Aggregate } from "./aggregate";
export { SchemaFunction } from "./schema-function";
export { Index, IndexKind } from "./schema-index";
export { TableMetadata, ColumnMetadata, ColumnKind } from "./table-metadata";
export { MaterializedView } from "./materialized-view";
export { Udt, UdtField } from "./user-defined-type";
export { KeyspaceMetadata } from "../../index";
export type {
    SimpleStrategy,
    NetworkTopologyStrategy,
    LocalStrategy,
    OtherStrategy,
    Strategy,
} from "./strategy";
export { StrategyKind } from "./strategy";
export { ClientState };

/**
 * Represents cluster and schema information.
 * The metadata class acts as a internal state of the driver.
 */
class Metadata {
    #rustClient: RustClient;

    /**
     * Creates a new instance of {@link Metadata}.
     * @internal
     * @ignore
     */
    constructor(rustClient: RustClient) {
        this.#rustClient = rustClient;
    }

    /**
     * Gets the keyspace metadata by name.
     * @param {string} name Name of the keyspace.
     * @returns {KeyspaceMetadata | null} The keyspace metadata, or `null` if it does not exist.
     */
    getKeyspace(name: string): KeyspaceMetadata | null {
        return this.#rustClient.getKeyspaceMetadata(name);
    }

    /**
     * Gets all keyspace metadata.
     * @returns {Readonly<Record<string, KeyspaceMetadata>>} Every keyspace, keyed by name.
     */
    getKeyspaces(): Readonly<Record<string, KeyspaceMetadata>> {
        return this.#rustClient.getAllKeyspaces();
    }

    /**
     * Gets the host list representing the replicas that contain the given partition key, token or token range.
     *
     * It uses the pre-loaded keyspace metadata to retrieve the replicas for a token for a given keyspace.
     * When the keyspace metadata has not been loaded, it returns null.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {Buffer | Token | TokenRange} token Can be Buffer (serialized partition key),
     * Token or TokenRange.
     * @returns {Host[]} The replicas.
     */
    getReplicas(
        keyspaceName: string,
        token: Buffer | Token | TokenRange,
    ): Host[] {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the token ranges that define data distribution in the ring.
     * @returns {Set<TokenRange>} The ranges of the ring or empty set if schema metadata is not enabled.
     */
    getTokenRanges(): Set<TokenRange> {
        let ringTokens = this.#rustClient.getRingTokens();
        const tokenRanges = new Set<TokenRange>();
        if (ringTokens.length === 1) {
            // A single token owns the whole ring, that is the range ]minToken, minToken].
            tokenRanges.add(minTokenRange());
            return tokenRanges;
        }
        for (let i = 0; i < ringTokens.length; i++) {
            tokenRanges.add(
                new TokenRange(
                    ringTokens[i],
                    ringTokens[(i + 1) % ringTokens.length],
                ),
            );
        }
        return tokenRanges;
    }

    /**
     * Gets the token ranges that are replicated on the given host, for the given keyspace.
     * @param {string} keyspaceName The name of the keyspace to get ranges for.
     * @param {Host} host The host.
     * @returns {Set<TokenRange> | null} Ranges for the keyspace on this host or null if keyspace
     * isn't found or hasn't been loaded.
     */
    getTokenRangesForHost(
        keyspaceName: string,
        host: Host,
    ): Set<TokenRange> | null {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Constructs a Token from the input buffer(s)
     *
     * The token of a partition key is computed by the Rust driver, which reads the partitioner
     * from the table's own metadata, so the components have to be the values of that table's
     * partition key columns, in the order the table declares them, each already serialized with
     * the CQL type of its column.
     * @example <caption>Composite partition key</caption>
     * // Given:
     * //   CREATE TABLE ks1.users (
     * //     user_id int,
     * //     region text,
     * //     created_at timestamp,
     * //     PRIMARY KEY ((user_id, region), created_at)
     * //   )
     * // the partition key is (user_id, region), so the components must be provided in that
     * // order: the encoded user_id, then the encoded region.
     * const userId = Buffer.alloc(4);
     * userId.writeInt32BE(42);
     * const region = Buffer.from("eu-west", "utf8");
     * const t = client.metadata.newToken([userId, region], "ks1", "users");
     * @param {Buffer[] | Buffer} components The token components.
     * @param {string} keyspaceName Name of the keyspace the table belongs to.
     * @param {string} tableName Name of the table the partition key belongs to.
     * @returns {Token} Constructed token from the input buffer.
     */
    newToken(
        components: Buffer[] | Buffer,
        keyspaceName: string,
        tableName: string,
    ): Token {
        return this.#rustClient.computeToken(
            Array.isArray(components) ? components : [components],
            keyspaceName,
            tableName,
        );
    }

    /**
     * Constructs a TokenRange from the given start and end tokens.
     * @param {Token} start The start token.
     * @param {Token} end The end token.
     * @returns {TokenRange} Build range spanning from start (exclusive) to end (inclusive).
     */
    newTokenRange(start: Token, end: Token): TokenRange {
        return new TokenRange(start, end);
    }

    /**
     * Gets the definition of an user-defined type.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the UDT.
     * @returns {Udt | null} The UDT definition, or `null` if it does not exist.
     */
    getUdt(keyspaceName: string, name: string): Udt | null {
        return this.#rustClient.getUdt(keyspaceName, name);
    }

    /**
     * Gets the definition of a table.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the Table.
     * @returns {TableMetadata | null} The table metadata, or `null` if it does not exist.
     */
    getTable(keyspaceName: string, name: string): TableMetadata | null {
        return this.#rustClient.getTable(keyspaceName, name);
    }

    /**
     * Gets the definition of CQL functions for a given name.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the Function.
     * @returns {ReadonlyArray<SchemaFunction>} An array of schema function metadata.
     */
    getFunctions(
        keyspaceName: string,
        name: string,
    ): readonly SchemaFunction[] {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets a definition of CQL function for a given name and signature.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the Function.
     * @param {string[] | ColumnInfo[]} signature Array of types of the parameters.
     * @returns {SchemaFunction | null} The schema function metadata, or `null` if it does not
     * exist.
     */
    getFunction(
        keyspaceName: string,
        name: string,
        signature: string[] | ColumnInfo[],
    ): SchemaFunction | null {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of CQL aggregate for a given name.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the aggregate.
     * @returns {ReadonlyArray<Aggregate>} An array of schema aggregate metadata.
     */
    getAggregates(keyspaceName: string, name: string): readonly Aggregate[] {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets a definition of CQL aggregate for a given name and signature.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the aggregate.
     * @param {string[] | ColumnInfo[]} signature Array of types of the parameters.
     * @returns {Aggregate | null} The schema aggregate metadata, or `null` if it does not exist.
     */
    getAggregate(
        keyspaceName: string,
        name: string,
        signature: string[] | ColumnInfo[],
    ): Aggregate | null {
        throw new Error("TODO: Not implemented");
    }

    /**
     * Gets the definition of a CQL materialized view for a given name.
     *
     * Note that, unlike the rest of the {@link Metadata} methods, this method does not cache the result for following
     * calls, as the current version of the Cassandra native protocol does not support schema change events for
     * materialized views. Each call to this method will produce one or more queries to the cluster.
     * @param {string} keyspaceName Name of the keyspace.
     * @param {string} name Name of the materialized view.
     * @returns {MaterializedView | null} The materialized view definition, or `null` if it does
     * not exist.
     */
    getMaterializedView(
        keyspaceName: string,
        name: string,
    ): MaterializedView | null {
        return this.#rustClient.getMaterializedView(keyspaceName, name);
    }

    /**
     * Gets the trace session generated by Cassandra when query tracing is enabled for the
     * query. The trace itself is stored in Cassandra in the `sessions` and
     * `events` table in the `system_traces` keyspace and can be
     * retrieve manually using the trace identifier.
     *
     * Note: the `consistency` parameter is accepted for API compatibility but is currently not
     * supported – the underlying Rust driver always uses the consistency level configured for
     * tracing queries at the session level.
     * @param {types.Uuid} traceId Identifier of the trace session.
     * @param {types.consistencies} [consistency] The consistency level to obtain the trace.
     * @param {Function} [callback] Executes callback(err, result) when execution completed.
     * When not defined, the method will return a promise.
     * @returns {Promise<QueryTrace> | void}
     */
    getTrace(traceId: types.Uuid): Promise<QueryTrace>;
    getTrace(
        traceId: types.Uuid,
        consistency: types.consistencies,
    ): Promise<QueryTrace>;
    getTrace(traceId: types.Uuid, callback: ValueCallback<QueryTrace>): void;
    getTrace(
        traceId: types.Uuid,
        consistency: types.consistencies,
        callback: ValueCallback<QueryTrace>,
    ): void;
    getTrace(
        traceId: types.Uuid,
        consistency?: types.consistencies | ValueCallback<QueryTrace>,
        callback?: ValueCallback<QueryTrace>,
    ): Promise<QueryTrace> | void {
        if (!callback && typeof consistency === "function") {
            callback = consistency;
            consistency = undefined;
        }

        return promiseUtils.optionalCallback(
            this.#getTrace(
                traceId,
                consistency as types.consistencies | undefined,
            ),
            callback,
        );
    }

    /**
     * Async-only version of {@link Metadata#getTrace()}, so that reading the trace id failing –
     * which throws synchronously – is reported like any other error: through the callback, when
     * one was provided.
     * @param {Uuid} traceId Identifier of the trace session.
     * @param {Number} [consistency] The consistency level to obtain the trace.
     * @returns {Promise<QueryTrace>}
     */
    async #getTrace(
        traceId: types.Uuid,
        consistency: types.consistencies | undefined,
    ): Promise<QueryTrace> {
        return this.#rustClient.getTracingInfo(traceId.getBuffer());
    }

    /**
     * Checks whether hosts that are currently up agree on the schema definition.
     *
     * This method performs a one-time check only, without any form of retry; therefore
     * `protocolOptions.maxSchemaAgreementWaitSeconds` setting does not apply in this case.
     * @param {Function} [callback] Executes callback(err, agreement) when execution completed.
     * When not defined, the method will return a promise.
     * @returns {Promise<boolean> | void} `true` when all hosts agree on the schema and `false`
     * when there is no agreement or when the check could not be performed (for example, if a
     * host's connection is down).
     */
    checkSchemaAgreement(
        callback?: ValueCallback<boolean>,
    ): Promise<boolean> | void {
        return promiseUtils.optionalCallback(
            this.#rustClient.checkSchemaAgreement(),
            callback,
        );
    }

    /**
     * Waits until all currently reachable hosts agree on the schema definition.
     *
     * This method actively checks whether schema agreement was established, for up to
     * `protocolOptions.maxSchemaAgreementWaitSeconds` – rejecting if agreement is not reached
     * within that time, or if the check could not be performed at all (for example, if no host
     * is reachable).
     * @param {Function} [callback] Executes callback(err) when execution completed. When not
     * defined, the method will return a promise.
     * @returns {Promise<void> | void}
     */
    waitForSchemaAgreement(callback?: EmptyCallback): Promise<void> | void {
        return promiseUtils.optionalCallback(
            this.#rustClient.waitForSchemaAgreement(),
            callback,
        );
    }
}

export { Metadata };
