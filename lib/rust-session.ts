"use strict";

import rust = require("../index");
import type { RustQueryOptions } from "./query-options";
import type { HostMap, Replica } from "./host";
import type { Token } from "./token";
import type { QueryTrace } from "./metadata/query-trace";
import type { TableMetadata } from "./metadata/table-metadata";
import type { MaterializedView } from "./metadata/materialized-view";
import type { Udt } from "./metadata/user-defined-type";

/** A native prepared handle and its bind metadata: (expected type, variable name) pairs. */
type PreparedHandleWithBindMetadata = [
    rust.ExternalObject<rust.PreparedStatementWrapper>,
    Array<[rust.ComplexType, string]>,
];

/**
 * The native session of the driver.
 *
 * Rust gives the session to JS as an `External`, not as an instance of a native class.
 * A method call on an instance of a native class costs `napi_unwrap` and a borrow check
 * of napi-rs. JS uses the session in each execution, so this cost adds up.
 * This class gives the session the same methods that the native class had.
 * Each method calls one Rust function with the `External`.
 * @internal
 */
export class RustSession {
    readonly #inner: rust.ExternalObject<rust.SessionWrapper>;

    private constructor(inner: rust.ExternalObject<rust.SessionWrapper>) {
        this.#inner = inner;
    }

    /** Creates a session based on the provided session options. */
    static async create(options: rust.SessionOptions): Promise<RustSession> {
        return new RustSession(await rust.createSession(options));
    }

    /** The native session, for the Rust functions that take it as an argument. */
    get inner(): rust.ExternalObject<rust.SessionWrapper> {
        return this.#inner;
    }

    prepareStatement(
        statement: string,
    ): Promise<PreparedHandleWithBindMetadata> {
        return rust.sessionPrepareStatement(this.#inner, statement);
    }

    executePreparedSinglePage(
        handle: rust.ExternalObject<rust.PreparedStatementWrapper>,
        params: rust.SerializedValuesWrapper,
        options: RustQueryOptions,
        pagingState?: Buffer,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionExecutePreparedSinglePage(
            this.#inner,
            handle,
            params,
            ...options,
            pagingState,
        );
    }

    executePreparedUnpaged(
        handle: rust.ExternalObject<rust.PreparedStatementWrapper>,
        params: rust.SerializedValuesWrapper,
        options: RustQueryOptions,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionExecutePreparedUnpaged(
            this.#inner,
            handle,
            params,
            ...options,
        );
    }

    querySinglePage(
        query: string,
        params: Array<rust.EncodedValuesWrapper>,
        options: RustQueryOptions,
        pagingState?: Buffer,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionQuerySinglePage(
            this.#inner,
            query,
            params,
            ...options,
            pagingState,
        );
    }

    queryUnpaged(
        query: string,
        params: Array<rust.EncodedValuesWrapper>,
        options: RustQueryOptions,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionQueryUnpaged(this.#inner, query, params, ...options);
    }

    createBatch(
        statements: Array<string>,
        options: RustQueryOptions,
    ): rust.BatchWrapper {
        return rust.sessionCreateBatch(this.#inner, statements, ...options);
    }

    createPreparedBatch(
        statements: Array<rust.ExternalObject<rust.PreparedStatementWrapper>>,
        options: RustQueryOptions,
    ): rust.BatchWrapper {
        return rust.sessionCreatePreparedBatch(
            this.#inner,
            statements,
            ...options,
        );
    }

    batch(
        batch: rust.BatchWrapper,
        params: Array<Array<rust.EncodedValuesWrapper>>,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionBatch(this.#inner, batch, params);
    }

    getKeyspace(): string | null {
        return rust.sessionGetKeyspace(this.#inner);
    }

    checkSchemaAgreement(): Promise<boolean> {
        return rust.sessionCheckSchemaAgreement(this.#inner);
    }

    waitForSchemaAgreement(): Promise<void> {
        return rust.sessionWaitForSchemaAgreement(this.#inner);
    }

    getTracingInfo(tracingId: Buffer): Promise<QueryTrace> {
        return rust.sessionGetTracingInfo(this.#inner, tracingId);
    }

    getAllHosts(): HostMap {
        return rust.sessionGetAllHosts(this.#inner);
    }

    getReplicas(keyspace: string, table: string, token: bigint): Replica[] {
        return rust.sessionGetReplicas(this.#inner, keyspace, table, token);
    }

    computeToken(
        components: Array<rust.EncodedValuesWrapper>,
        keyspace: string,
        table: string,
    ): Token {
        return rust.sessionComputeToken(
            this.#inner,
            components,
            keyspace,
            table,
        );
    }

    getRingTokens(): Token[] {
        return rust.sessionGetRingTokens(this.#inner);
    }

    getKeyspaceMetadata(name: string): rust.KeyspaceWrapper | null {
        return rust.sessionGetKeyspaceMetadata(this.#inner, name);
    }

    getAllKeyspaces(): Readonly<Record<string, rust.KeyspaceWrapper>> {
        return rust.sessionGetAllKeyspaces(this.#inner);
    }

    getTable(keyspace: string, table: string): TableMetadata | null {
        return rust.sessionGetTable(this.#inner, keyspace, table);
    }

    getMaterializedView(
        keyspace: string,
        view: string,
    ): MaterializedView | null {
        return rust.sessionGetMaterializedView(this.#inner, keyspace, view);
    }

    getUdt(keyspace: string, name: string): Udt | null {
        return rust.sessionGetUdt(this.#inner, keyspace, name);
    }
}
