"use strict";

import rust = require("../index");
import type { RustQueryOptions } from "./query-options";
import type { HostMap, Replica } from "./host";
import type { Token } from "./token";
import type { QueryTrace } from "./metadata/query-trace";
import type { TableMetadata } from "./metadata/table-metadata";
import type { MaterializedView } from "./metadata/materialized-view";
import type { Udt } from "./metadata/user-defined-type";
import type { CqlValue } from "../main";
import type Encoder = require("./encoder");
import type { ColumnInfo } from "./types/cql-utils";
import { FrameWriter } from "./frame-writer";

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
 *
 * This class also owns the values frames of the session.
 * Its methods take the values, encode them into a frame, and pass the frame to Rust.
 * A frame is a view of one shared {@link FrameWriter} buffer, and the next frame overwrites it.
 * Thus, these rules keep concurrent requests from sending each other's values:
 * - A frame never leaves this class. Callers cannot keep one across an `await`.
 * - Each method that writes a frame is not `async`.
 *   Thus, `await` between writing the frame and the native call is a compile error.
 *   Do not make these methods `async`.
 * - Rust copies the frame before the native call returns.
 * @internal
 */
export class RustSession {
    readonly #inner: rust.ExternalObject<rust.SessionWrapper>;
    readonly #encoder: Encoder;
    readonly #frameWriter = new FrameWriter();

    private constructor(
        inner: rust.ExternalObject<rust.SessionWrapper>,
        encoder: Encoder,
    ) {
        this.#inner = inner;
        this.#encoder = encoder;
    }

    /**
     * Creates a session based on the provided session options.
     * @param encoder Encodes the values of the requests of this session.
     */
    static async create(
        options: rust.SessionOptions,
        encoder: Encoder,
    ): Promise<RustSession> {
        return new RustSession(await rust.createSession(options), encoder);
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
        types: Array<ColumnInfo | null>,
        params: Array<CqlValue>,
        options: RustQueryOptions,
        pagingState?: Buffer,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionExecutePreparedSinglePage(
            this.#inner,
            handle,
            this.#frameWriter.params(types, params, this.#encoder),
            ...options,
            pagingState,
        );
    }

    executePreparedUnpaged(
        handle: rust.ExternalObject<rust.PreparedStatementWrapper>,
        types: Array<ColumnInfo | null>,
        params: Array<CqlValue>,
        options: RustQueryOptions,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionExecutePreparedUnpaged(
            this.#inner,
            handle,
            this.#frameWriter.params(types, params, this.#encoder),
            ...options,
        );
    }

    querySinglePage(
        query: string,
        types: Array<ColumnInfo | null>,
        params: Array<CqlValue>,
        options: RustQueryOptions,
        pagingState?: Buffer,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionQuerySinglePage(
            this.#inner,
            query,
            this.#frameWriter.params(types, params, this.#encoder),
            ...options,
            pagingState,
        );
    }

    queryUnpaged(
        query: string,
        types: Array<ColumnInfo | null>,
        params: Array<CqlValue>,
        options: RustQueryOptions,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionQueryUnpaged(
            this.#inner,
            query,
            this.#frameWriter.params(types, params, this.#encoder),
            ...options,
        );
    }

    /**
     * @param types The expected types, one list for each statement.
     * @param params The values, one array for each statement.
     */
    batch(
        statements: Array<string>,
        types: Array<Array<ColumnInfo | null>>,
        params: Array<Array<CqlValue>>,
        options: RustQueryOptions,
        batchKind: rust.BatchKind,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionBatch(
            this.#inner,
            statements,
            this.#frameWriter.batch(types, params, this.#encoder),
            ...options,
            batchKind,
        );
    }

    /**
     * @param types The expected types, one list for each statement.
     * @param params The values, one array for each statement.
     */
    batchPrepared(
        statements: Array<rust.ExternalObject<rust.PreparedStatementWrapper>>,
        types: Array<Array<ColumnInfo | null>>,
        params: Array<Array<CqlValue>>,
        options: RustQueryOptions,
        batchKind: rust.BatchKind,
    ): Promise<rust.ExternalObject<rust.QueryResultWrapper>> {
        return rust.sessionBatchPrepared(
            this.#inner,
            statements,
            this.#frameWriter.batch(types, params, this.#encoder),
            ...options,
            batchKind,
        );
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

    /**
     * @param components The partition key values, already encoded.
     * `null` is null, and `undefined` is unset.
     */
    computeToken(
        components: Array<Uint8Array | null | undefined>,
        keyspace: string,
        table: string,
    ): Token {
        return rust.sessionComputeToken(
            this.#inner,
            this.#frameWriter.buffers(components),
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
