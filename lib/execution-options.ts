"use strict";

import utils = require("./utils");
import types = require("./types");
import errors = require("./errors");
import _rust = require("../index");
import { queryOptionsIntoWrapper } from "./query-options";
import {
    validateRequestTimeout,
    rejectUnsupportedReadTimeout,
} from "./new-utils";
import type { ExecutionProfile } from "./execution-profile";
import type { Host, QueryOptions, policies as policiesModule } from "../";

type LoadBalancingPolicy = policiesModule.loadBalancing.LoadBalancingPolicy;
type RetryPolicy = policiesModule.retry.RetryPolicy;
type CustomPayload = { [key: string]: any };

const proxyExecuteKey = "ProxyExecute";

/**
 * A base class that represents a wrapper around the user provided query options with getter methods and proper
 * default values.
 *
 * Note that getter methods might return `undefined` when not set on the query options or default
 * {@link Client} options.
 */
class ExecutionOptions {
    #rustWrapper?: _rust.QueryOptionsWrapper;

    /**
     * Creates a new instance of {@link ExecutionOptions}.
     */
    constructor() {}

    /** @internal */
    protected setRustWrapper(rustWrapper: _rust.QueryOptionsWrapper): void {
        this.#rustWrapper = rustWrapper;
    }

    /**
     * Creates rust options wrapper for this execution options unless it already exists.
     * Goal of this function is to avoid wrapping the same options multiple times.
     * @internal
     * @ignore
     */
    wrapOptionsIfNotWrappedYet(): void {
        if (!this.#rustWrapper) {
            this.#rustWrapper = queryOptionsIntoWrapper(this);
        }
    }

    /**
     * Get this options as rust wrapper.
     * @internal
     * @ignore
     */
    getRustOptions(): _rust.QueryOptionsWrapper {
        this.wrapOptionsIfNotWrappedYet();
        return this.#rustWrapper!;
    }

    /**
     * Creates an empty instance, where all methods return undefined, used internally.
     * @internal
     * @ignore
     */
    static empty(): ExecutionOptions {
        return new ExecutionOptions();
    }

    /**
     * Determines if the stack trace before the query execution should be maintained.
     * @abstract
     */
    getCaptureStackTrace(): boolean | undefined {
        return undefined;
    }

    /**
     * Gets the [Consistency level]{@link module:types~consistencies} to be used for the execution.
     * @abstract
     */
    getConsistency(): types.consistencies | undefined {
        return undefined;
    }

    /**
     * Key-value payload to be passed to the server. On the server side, implementations of QueryHandler can use
     * this data.
     * @abstract
     */
    getCustomPayload(): CustomPayload | undefined {
        return undefined;
    }

    /**
     * Gets the amount of rows to retrieve per page.
     * @abstract
     */
    getFetchSize(): number | undefined {
        return undefined;
    }

    /**
     * When a fixed host is set on the query options and the query plan for the load-balancing policy is not used, it
     * gets the host that should handle the query.
     */
    getFixedHost(): Host | undefined {
        return undefined;
    }

    /**
     * Gets the type hints for parameters given in the query, ordered as for the parameters.
     * @abstract
     */
    getHints(): Array<any> | undefined {
        return undefined;
    }

    /**
     * Determines whether the driver must retrieve the following result pages automatically.
     *
     * This setting is only considered by the [Client#eachRow()]{@link Client#eachRow} method.
     * @abstract
     */
    isAutoPage(): boolean | undefined {
        return undefined;
    }

    /**
     * Determines whether its a counter batch. Only valid for [Client#batch()]{@link Client#batch}, it will be ignored by
     * other methods.
     * @abstract
     */
    isBatchCounter(): boolean | undefined {
        return undefined;
    }

    /**
     * Determines whether the batch should be written to the batchlog. Only valid for
     * [Client#batch()]{@link Client#batch}, it will be ignored by other methods.
     * @abstract
     */
    isBatchLogged(): boolean | undefined {
        return undefined;
    }

    /**
     * Determines whether the query can be applied multiple times without changing the result beyond the initial
     * application.
     * @abstract
     */
    isIdempotent(): boolean | undefined {
        return undefined;
    }

    /**
     * Determines whether the query must be prepared beforehand.
     * @abstract
     */
    isPrepared(): boolean | undefined {
        return undefined;
    }

    /**
     * Determines whether query tracing is enabled for the execution.
     * @abstract
     */
    isQueryTracing(): boolean | undefined {
        return undefined;
    }

    /**
     * Gets the keyspace for the query when set at query options level.
     *
     * Note that this method will return `undefined` when the keyspace is not set at query options level.
     * It will only return the keyspace name when the user provided a different keyspace than the current
     * {@link Client} keyspace.
     * @abstract
     */
    getKeyspace(): string | undefined {
        return undefined;
    }

    /**
     * Gets the load balancing policy used for this execution.
     */
    getLoadBalancingPolicy(): LoadBalancingPolicy | undefined {
        return undefined;
    }

    /**
     * Determines if the query should be paged.
     * @abstract
     * @internal
     * @ignore
     */
    isPaged(): boolean | undefined {
        return undefined;
    }

    /**
     * Gets the Buffer representing the paging state.
     * @abstract
     */
    getPageState(): Buffer | undefined {
        return undefined;
    }

    /**
     * Internal method that gets the preferred host.
     * @abstract
     * @internal
     * @ignore
     */
    getPreferredHost(): any {
        return undefined;
    }

    /**
     * Gets the query options stored by this instance without setting default values.
     */
    getRawQueryOptions(): QueryOptions | undefined {
        return undefined;
    }

    /**
     * Gets the client-side deadline in milliseconds for statement execution
     * (acquiring a single page of results).
     *
     * A value of `0` disables the deadline for the execution. Default: `undefined`.
     * @abstract
     */
    getRequestTimeout(): number | undefined {
        return undefined;
    }

    /**
     * Gets the legacy per-attempt read timeout setting. This setting is unsupported
     * and does not affect native execution. Retained for API compatibility.
     * @deprecated Use {@link ExecutionOptions#getRequestTimeout}.
     */
    getReadTimeout(): number | undefined {
        return undefined;
    }

    /**
     * Gets the [retry policy]{@link module:policies/retry} to be used.
     * @abstract
     */
    getRetryPolicy(): RetryPolicy | undefined {
        return undefined;
    }

    /**
     * Internal method to obtain the row callback, for "by row" results.
     * @abstract
     * @internal
     * @ignore
     */
    getRowCallback(): Function | undefined | null {
        return undefined;
    }

    /**
     * Internal method to get or generate a timestamp for the request execution.
     * @internal
     * @ignore
     */
    getOrGenerateTimestamp(): types.Long | null | undefined {
        return undefined;
    }

    /**
     * Gets the index of the parameters that are part of the partition key to determine the routing.
     * @abstract
     * @internal
     * @ignore
     */
    getRoutingIndexes(): Array<number> | undefined {
        return undefined;
    }

    /**
     * Gets the partition key(s) to determine which coordinator should be used for the query.
     * @abstract
     */
    getRoutingKey(): Buffer | Array<Buffer> | null | undefined {
        return undefined;
    }

    /**
     * Gets the array of the parameters names that are part of the partition key to determine the
     * routing. Only valid for non-prepared requests.
     * @abstract
     * @internal
     * @ignore
     */
    getRoutingNames(): Array<string> | undefined {
        return undefined;
    }

    /**
     * Gets the the consistency level to be used for the serial phase of conditional updates.
     * @abstract
     */
    getSerialConsistency(): types.consistencies | undefined {
        return undefined;
    }

    /**
     * Gets the provided timestamp for the execution in microseconds from the unix epoch (00:00:00, January 1st, 1970).
     *
     * When a timestamp generator is used, this method returns `undefined`.
     * @abstract
     */
    getTimestamp(): number | types.Long | undefined | null {
        return undefined;
    }

    /**
     * @abstract
     * @internal
     * @ignore
     */
    setHints(hints: Array<any>): void {}

    /**
     * Sets the keyspace for the execution.
     * @ignore
     * @internal
     * @abstract
     */
    setKeyspace(keyspace: string): void {}

    /**
     * @abstract
     * @internal
     * @ignore
     */
    setPageState(pageState?: Buffer): void {}

    /**
     * Internal method that sets the preferred host.
     * @abstract
     * @internal
     * @ignore
     */
    setPreferredHost(host?: Host): void {}

    /**
     * Sets the index of the parameters that are part of the partition key to determine the routing.
     * @abstract
     * @internal
     * @ignore
     */
    setRoutingIndexes(routingIndexes: Array<number>): void {}

    /**
     * Sets the routing key.
     * @abstract
     * @internal
     * @ignore
     */
    setRoutingKey(value?: Buffer | Array<Buffer> | null): void {}
}

/**
 * Internal implementation of {@link ExecutionOptions} that uses the value from the client options and execution
 * profile into account.
 * @ignore
 */
class DefaultExecutionOptions extends ExecutionOptions {
    #queryOptions: QueryOptions;
    #rowCallback: Function | null | undefined;
    #routingKey: Buffer | Array<Buffer> | null | undefined;
    #hints: Array<any> | undefined;
    #keyspace: string | undefined;
    #routingIndexes: Array<number> | undefined;
    #pageState: Buffer | undefined;
    #client: any;
    #defaultQueryOptions: QueryOptions;
    #profile: ExecutionProfile;
    #customPayload: CustomPayload | undefined;

    /**
     * Creates a new instance of {@link ExecutionOptions}.
     */
    constructor(
        queryOptions: QueryOptions,
        client: any,
        rowCallback?: Function | null,
    ) {
        super();

        this.#queryOptions = queryOptions;
        rejectUnsupportedReadTimeout(
            this.#queryOptions.readTimeout,
            "QueryOptions.readTimeout",
            false,
        );
        validateRequestTimeout(
            this.#queryOptions.requestTimeout,
            "QueryOptions.requestTimeout",
        );
        this.#rowCallback = rowCallback;
        this.#routingKey = this.#queryOptions.routingKey;
        this.#hints = this.#queryOptions.hints;
        this.#keyspace = this.#queryOptions.keyspace;
        this.#routingIndexes = this.#queryOptions.routingIndexes;
        this.#pageState =
            typeof this.#queryOptions.pageState === "string"
                ? utils.allocBufferFromString(
                      this.#queryOptions.pageState,
                      "hex",
                  )
                : this.#queryOptions.pageState;

        this.#client = client;
        this.#defaultQueryOptions = client.options.queryOptions!;
        this.#profile = client.profileManager.getProfile(
            this.#queryOptions.executionProfile,
        )!;

        // Build a custom payload object designed for DSE-specific functionality
        this.#customPayload = DefaultExecutionOptions.createCustomPayload(
            this.#queryOptions,
            this.#defaultQueryOptions,
        );

        if (!this.#profile) {
            throw new errors.ArgumentError(
                `Execution profile "${this.#queryOptions.executionProfile}" not found`,
            );
        }
    }

    /**
     * Creates a payload for given user.
     * @private
     */
    static createCustomPayload(
        userOptions: QueryOptions,
        defaultQueryOptions: QueryOptions,
    ): CustomPayload | undefined {
        let customPayload: CustomPayload | undefined =
            userOptions.customPayload || defaultQueryOptions.customPayload;
        const executeAs =
            (userOptions as any).executeAs ||
            (defaultQueryOptions as any).executeAs;

        if (executeAs) {
            if (!customPayload) {
                customPayload = {};
                customPayload[proxyExecuteKey] =
                    utils.allocBufferFromString(executeAs);
            } else if (!customPayload[proxyExecuteKey]) {
                // Avoid appending to the existing payload object
                customPayload = utils.extend(
                    {},
                    customPayload,
                ) as CustomPayload;
                customPayload[proxyExecuteKey] =
                    utils.allocBufferFromString(executeAs);
            }
        }

        return customPayload;
    }

    /**
     * Creates a new instance {@link ExecutionOptions}, based on the query options.
     * @ignore
     */
    static create(
        queryOptions: QueryOptions | Function | null | undefined,
        client: any,
        rowCallback?: Function | null,
    ): DefaultExecutionOptions {
        if (!queryOptions || typeof queryOptions === "function") {
            // queryOptions can be null/undefined and could be of type function when is an optional parameter
            queryOptions = utils.emptyObject;
        }
        return new DefaultExecutionOptions(queryOptions, client, rowCallback);
    }

    getCaptureStackTrace(): boolean | undefined {
        return ifUndefined(
            this.#queryOptions.captureStackTrace,
            this.#defaultQueryOptions.captureStackTrace,
        );
    }

    getConsistency(): types.consistencies | undefined {
        return ifUndefined3(
            this.#queryOptions.consistency,
            this.#profile.consistency,
            this.#defaultQueryOptions.consistency,
        );
    }

    getCustomPayload(): CustomPayload | undefined {
        return this.#customPayload;
    }

    getFetchSize(): number | undefined {
        return ifUndefined(
            this.#queryOptions.fetchSize,
            this.#defaultQueryOptions.fetchSize,
        );
    }

    getFixedHost(): Host | undefined {
        return this.#queryOptions.host;
    }

    getHints(): Array<any> | undefined {
        return this.#hints;
    }

    isAutoPage(): boolean | undefined {
        return ifUndefined(
            this.#queryOptions.autoPage,
            this.#defaultQueryOptions.autoPage,
        );
    }

    isBatchCounter(): boolean | undefined {
        return ifUndefined(this.#queryOptions.counter, false);
    }

    isBatchLogged(): boolean | undefined {
        return ifUndefined3(
            this.#queryOptions.logged,
            this.#defaultQueryOptions.logged,
            true,
        );
    }

    isIdempotent(): boolean | undefined {
        return ifUndefined(
            this.#queryOptions.isIdempotent,
            this.#defaultQueryOptions.isIdempotent,
        );
    }

    /**
     * Determines if the query execution must be prepared beforehand.
     */
    isPrepared(): boolean | undefined {
        return ifUndefined(
            this.#queryOptions.prepare,
            this.#defaultQueryOptions.prepare,
        );
    }

    isQueryTracing(): boolean | undefined {
        return ifUndefined(
            this.#queryOptions.traceQuery,
            this.#defaultQueryOptions.traceQuery,
        );
    }

    getKeyspace(): string | undefined {
        return this.#keyspace;
    }

    getLoadBalancingPolicy(): LoadBalancingPolicy | undefined {
        return this.#profile.loadBalancing;
    }

    /** @internal */
    getOrGenerateTimestamp(): types.Long | null | undefined {
        return resolveExecutionTimestamp(
            this.getTimestamp(),
            this.#client,
            () => this.#client.options.policies!.timestampGeneration,
        );
    }

    /** @internal */
    isPaged(): boolean | undefined {
        return ifUndefined(
            (this.#queryOptions as any).paged,
            (this.#defaultQueryOptions as any).paged,
        );
    }

    getPageState(): Buffer | undefined {
        return this.#pageState;
    }

    /**
     * Gets the profile defined by the user or the default profile
     * @internal
     * @ignore
     */
    getProfile(): ExecutionProfile {
        return this.#profile;
    }

    getRawQueryOptions(): QueryOptions | undefined {
        return this.#queryOptions;
    }

    getRequestTimeout(): number | undefined {
        return ifUndefined3(
            this.#queryOptions.requestTimeout,
            this.#profile.requestTimeout,
            this.#client.options.requestTimeout,
        );
    }

    getReadTimeout(): number | undefined {
        return ifUndefined3(
            this.#queryOptions.readTimeout,
            this.#profile.readTimeout,
            this.#client.options.socketOptions!.readTimeout,
        );
    }

    getRetryPolicy(): RetryPolicy | undefined {
        return ifUndefined3(
            this.#queryOptions.retry,
            this.#profile.retry,
            this.#client.options.policies!.retry,
        );
    }

    /** @internal */
    getRoutingIndexes(): Array<number> | undefined {
        return this.#routingIndexes;
    }

    getRoutingKey(): Buffer | Array<Buffer> | null | undefined {
        return this.#routingKey;
    }

    /** @internal */
    getRoutingNames(): Array<string> | undefined {
        return this.#queryOptions.routingNames;
    }

    /**
     * Internal method to obtain the row callback, for "by row" results.
     * @internal
     * @ignore
     */
    getRowCallback(): Function | undefined | null {
        return this.#rowCallback;
    }

    getSerialConsistency(): types.consistencies | undefined {
        return ifUndefined3(
            this.#queryOptions.serialConsistency,
            this.#profile.serialConsistency,
            this.#defaultQueryOptions.serialConsistency,
        );
    }

    getTimestamp(): number | types.Long | undefined | null {
        return this.#queryOptions.timestamp;
    }

    /**
     * Internal property to set the custom payload.
     * @ignore
     * @internal
     */
    setCustomPayload(payload: CustomPayload): void {
        this.#customPayload = payload;
    }

    /** @internal */
    setHints(hints: Array<any>): void {
        this.#hints = hints;
    }

    /** @internal */
    setKeyspace(keyspace: string): void {
        this.#keyspace = keyspace;
    }

    /** @internal */
    setPageState(pageState?: Buffer): void {
        this.#pageState = pageState;
    }

    /** @internal */
    setRoutingIndexes(routingIndexes: Array<number>): void {
        this.#routingIndexes = routingIndexes;
    }

    /** @internal */
    setRoutingKey(value?: Buffer | Array<Buffer> | null): void {
        this.#routingKey = value;
    }
}

function ifUndefined(v1: any, v2: any): any {
    return v1 !== undefined ? v1 : v2;
}

function ifUndefined3(v1: any, v2: any, v3: any): any {
    if (v1 !== undefined) {
        return v1;
    }
    return v2 !== undefined ? v2 : v3;
}

function resolveExecutionTimestamp(
    timestamp: number | types.Long | null | undefined,
    client: any,
    getGenerator: () => any,
): types.Long | null | undefined {
    let result = timestamp;
    if (result === undefined) {
        const generator = getGenerator();
        if (
            types.protocolVersion.supportsTimestamp(
                client.controlConnection.protocolVersion,
            ) &&
            generator
        ) {
            result = generator.next(client);
        } else {
            result = null;
        }
    }
    return typeof result === "number" ? types.Long.fromNumber(result) : result;
}

function snapshotValue(value: any, seen = new WeakMap<object, any>()): any {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Buffer.isBuffer(value)) {
        const copy = Buffer.from(value);
        seen.set(value, copy);
        return copy;
    }
    if (value instanceof types.Long) {
        const copy = types.Long.fromBits(value.low, value.high, value.unsigned);
        seen.set(value, copy);
        return copy;
    }
    if (Array.isArray(value)) {
        const copy: any[] = new Array(value.length);
        seen.set(value, copy);
        for (let i = 0; i < value.length; i++) {
            if (i in value) copy[i] = snapshotValue(value[i], seen);
        }
        return copy;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
        const copy = Object.create(prototype);
        seen.set(value, copy);
        for (const key of Reflect.ownKeys(value)) {
            const property = Object.getOwnPropertyDescriptor(value, key)!;
            Object.defineProperty(copy, key, {
                value: snapshotValue(Reflect.get(value, key), seen),
                enumerable: property.enumerable,
                writable: true,
                configurable: true,
            });
        }
        return copy;
    }
    // Policy and host instances retain their identity and behavior.
    return value;
}

function resolveReusableValues(options: QueryOptions, client: any) {
    const raw = snapshotValue(options) as QueryOptions;
    const resolved = DefaultExecutionOptions.create(raw, client);
    const profile = resolved.getProfile();
    const profileSnapshot = Object.assign(
        Object.create(Object.getPrototypeOf(profile)),
        profile,
    ) as ExecutionProfile;
    Object.freeze(profileSnapshot);
    if (raw.executionProfile === profile) {
        raw.executionProfile = profileSnapshot;
    }
    return {
        raw,
        profile: profileSnapshot,
        captureStackTrace: resolved.getCaptureStackTrace(),
        consistency: resolved.getConsistency(),
        customPayload: snapshotValue(resolved.getCustomPayload()),
        fetchSize: resolved.getFetchSize(),
        fixedHost: resolved.getFixedHost(),
        hints: snapshotValue(resolved.getHints()),
        autoPage: resolved.isAutoPage(),
        batchCounter: resolved.isBatchCounter(),
        batchLogged: resolved.isBatchLogged(),
        idempotent: resolved.isIdempotent(),
        prepared: resolved.isPrepared(),
        tracing: resolved.isQueryTracing(),
        keyspace: resolved.getKeyspace(),
        loadBalancing: resolved.getLoadBalancingPolicy(),
        paged: resolved.isPaged(),
        pageState: snapshotValue(resolved.getPageState()),
        requestTimeout: resolved.getRequestTimeout(),
        readTimeout: resolved.getReadTimeout(),
        retry: resolved.getRetryPolicy(),
        routingIndexes: snapshotValue(resolved.getRoutingIndexes()),
        routingKey: snapshotValue(resolved.getRoutingKey()),
        routingNames: snapshotValue(resolved.getRoutingNames()),
        serialConsistency: resolved.getSerialConsistency(),
        timestamp: snapshotValue(resolved.getTimestamp()),
        timestampGenerator: client.options.policies?.timestampGeneration,
    };
}

type ReusableValues = ReturnType<typeof resolveReusableValues>;

class ReusableExecutionOptions extends ExecutionOptions {
    #values: ReusableValues;
    #client: any;
    #customPayload: ReusableValues["customPayload"];
    #hints: ReusableValues["hints"];
    #keyspace: ReusableValues["keyspace"];
    #pageState: ReusableValues["pageState"];
    #routingIndexes: ReusableValues["routingIndexes"];
    #routingKey: ReusableValues["routingKey"];
    #routingNames: ReusableValues["routingNames"];
    #timestamp: ReusableValues["timestamp"];

    constructor(
        values: ReusableValues,
        client: any,
        rustWrapper?: _rust.QueryOptionsWrapper,
    ) {
        super();
        if (rustWrapper) this.setRustWrapper(rustWrapper);
        this.#values = values;
        this.#client = client;
        this.#customPayload = snapshotValue(values.customPayload);
        this.#hints = snapshotValue(values.hints);
        this.#keyspace = values.keyspace;
        this.#pageState = snapshotValue(values.pageState);
        this.#routingIndexes = snapshotValue(values.routingIndexes);
        this.#routingKey = snapshotValue(values.routingKey);
        this.#routingNames = snapshotValue(values.routingNames);
        this.#timestamp = snapshotValue(values.timestamp);
    }

    getCaptureStackTrace() {
        return this.#values.captureStackTrace;
    }
    getConsistency() {
        return this.#values.consistency;
    }
    getCustomPayload() {
        return this.#customPayload;
    }
    getFetchSize() {
        return this.#values.fetchSize;
    }
    getFixedHost() {
        return this.#values.fixedHost;
    }
    getHints() {
        return this.#hints;
    }
    isAutoPage() {
        return this.#values.autoPage;
    }
    isBatchCounter() {
        return this.#values.batchCounter;
    }
    isBatchLogged() {
        return this.#values.batchLogged;
    }
    isIdempotent() {
        return this.#values.idempotent;
    }
    isPrepared() {
        return this.#values.prepared;
    }
    isQueryTracing() {
        return this.#values.tracing;
    }
    getKeyspace() {
        return this.#keyspace;
    }
    getLoadBalancingPolicy() {
        return this.#values.loadBalancing;
    }
    isPaged() {
        return this.#values.paged;
    }
    getPageState() {
        return this.#pageState;
    }
    getProfile() {
        return this.#values.profile;
    }
    /** Returns a copy of the input captured when the handle was created. */
    getRawQueryOptions() {
        return snapshotValue(this.#values.raw) as QueryOptions;
    }
    getRequestTimeout() {
        return this.#values.requestTimeout;
    }
    getReadTimeout() {
        return this.#values.readTimeout;
    }
    getRetryPolicy() {
        return this.#values.retry;
    }
    getRoutingIndexes() {
        return this.#routingIndexes;
    }
    getRoutingKey() {
        return this.#routingKey;
    }
    getRoutingNames() {
        return this.#routingNames;
    }
    getSerialConsistency() {
        return this.#values.serialConsistency;
    }
    getTimestamp() {
        return this.#timestamp;
    }

    getOrGenerateTimestamp(): types.Long | null | undefined {
        return resolveExecutionTimestamp(
            this.getTimestamp(),
            this.#client,
            () => this.#values.timestampGenerator,
        );
    }

    setCustomPayload(payload: CustomPayload): void {
        this.#customPayload = payload;
    }
    setHints(hints: Array<any>): void {
        this.#hints = hints;
    }
    setKeyspace(keyspace: string): void {
        this.#keyspace = keyspace;
    }
    setPageState(pageState?: Buffer): void {
        this.#pageState = pageState;
    }
    setRoutingIndexes(indexes: Array<number>): void {
        this.#routingIndexes = indexes;
    }
    setRoutingKey(value?: Buffer | Array<Buffer> | null): void {
        this.#routingKey = value;
    }
}

/**
 * A client-owned snapshot of settings for repeated `execute()` calls.
 * Create it with {@link Client#createReusableOptions} and pass it only to
 * that client's `execute()` method. Each request receives independent mutable
 * state while sharing the compiled native query options.
 */
class ReusableQueryOptions {
    #client: any;
    #values: ReusableValues;
    #rustWrapper: _rust.QueryOptionsWrapper;

    private constructor(client: any, options: QueryOptions) {
        this.#client = client;
        this.#values = resolveReusableValues(options, client);
        const first = new ReusableExecutionOptions(this.#values, client);
        first.wrapOptionsIfNotWrappedYet();
        this.#rustWrapper = first.getRustOptions();
    }

    /** @internal */
    static create(client: any, options: QueryOptions): ReusableQueryOptions {
        return new ReusableQueryOptions(client, options);
    }

    /** @internal */
    forClient(client: any): ExecutionOptions {
        if (client !== this.#client) {
            throw new errors.ArgumentError(
                "Reusable query options belong to a different Client",
            );
        }
        return new ReusableExecutionOptions(
            this.#values,
            client,
            this.#rustWrapper,
        );
    }
}

export {
    ExecutionOptions,
    DefaultExecutionOptions,
    ReusableQueryOptions,
    proxyExecuteKey,
};
