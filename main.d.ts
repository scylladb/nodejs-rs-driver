import * as events from "events";
import { URL } from "url";
import net = require("node:net");
import * as auth from "./lib/auth";
import * as policies from "./lib/policies";
import * as types from "./lib/types";
import * as metrics from "./lib/metrics";
import * as tracker from "./lib/tracker";
import * as metadata from "./lib/metadata";
import { Host, HostMap } from "./lib/host";
import { Token, TokenRange } from "./lib/token";
import { ExecutionOptions } from "./lib/execution-options";
import { ClientOptions, SslOptions, ClientRoutesProxy } from "./lib/client-options";
import { QueryOptions } from "./lib/query-options";
import { ExecutionProfile } from "./lib/execution-profile";
import Long = types.Long;

// Export imported submodules
export * as concurrent from "./lib/concurrent";
export * as mapping from "./lib/mapping";
export * as errors from "./lib/errors";
export { auth, metadata, metrics, policies, tracker, types };
export { Host, HostMap };
export { ExecutionOptions };
export { ClientOptions, SslOptions, ClientRoutesProxy };
export { QueryOptions };
export { ExecutionProfile };

export const version: number;

export function defaultOptions(): ClientOptions;

export type ValueCallback<T> = (err: Error, val: T) => void;
export type EmptyCallback = (err: Error) => void;

/**
 * A single value that can be bound to a CQL query parameter.
 *
 * This covers every JavaScript value the driver's encoder accepts, including
 * the native primitives, `Buffer` (a pre-encoded `blob`), the driver's own
 * representation classes (see the {@link types} module) and the nested
 * collection forms used for CQL `list`, `set`, `map`, `tuple`, `udt` and
 * `vector` columns. While some duck-typing may be accepted by the driver, refrain from using it.
 *
 * Special values:
 * - `null` encodes a CQL `NULL`.
 * - {@link types.unset} encode an unset value (the latter is
 *   structurally an object and is matched by the object branch below).
 * - `undefined` represents either one of the above values, based on `encoding.useUndefinedAsUnset` options
 */
export type CqlValue =
  | null
  | undefined
  | boolean
  | number
  | bigint
  | string
  | Buffer
  | Date
  | Long
  | types.Integer
  | types.BigDecimal
  | types.Uuid
  | types.InetAddress
  | types.LocalDate
  | types.LocalTime
  | types.Duration
  | types.Tuple
  | types.Vector
  | CqlValue[]
  | Map<CqlValue, CqlValue>
  | Set<CqlValue>
  | { [key: string]: CqlValue };

/**
 * Query parameters bound to a statement, either as a positional array of
 * values or as an object keyed by named bind markers.
 */
export type ArrayOrObject = CqlValue[] | { [key: string]: CqlValue };

export class Client extends events.EventEmitter {
  hosts: HostMap;
  keyspace: string;
  metadata: metadata.Metadata;
  metrics: metrics.ClientMetrics;

  constructor(options: ClientOptions);

  connect(): Promise<void>;

  connect(callback: EmptyCallback): void;

  execute(
    query: string,
    params?: ArrayOrObject,
    options?: QueryOptions,
  ): Promise<types.ResultSet>;

  execute(
    query: string,
    params: ArrayOrObject,
    options: QueryOptions,
    callback: ValueCallback<types.ResultSet>,
  ): void;

  execute(
    query: string,
    params: ArrayOrObject,
    callback: ValueCallback<types.ResultSet>,
  ): void;

  execute(query: string, callback: ValueCallback<types.ResultSet>): void;

  eachRow(
    query: string,
    params: ArrayOrObject,
    options: QueryOptions,
    rowCallback: (n: number, row: types.Row) => void,
    callback?: ValueCallback<types.ResultSet>,
  ): void;

  eachRow(
    query: string,
    params: ArrayOrObject,
    rowCallback: (n: number, row: types.Row) => void,
    callback?: ValueCallback<types.ResultSet>,
  ): void;

  eachRow(
    query: string,
    rowCallback: (n: number, row: types.Row) => void,
  ): void;

  stream(
    query: string,
    params?: ArrayOrObject,
    options?: QueryOptions,
    callback?: EmptyCallback,
  ): events.EventEmitter;

  batch(
    queries: Array<string | { query: string; params?: ArrayOrObject }>,
    options?: QueryOptions,
  ): Promise<types.ResultSet>;

  batch(
    queries: Array<string | { query: string; params?: ArrayOrObject }>,
    options: QueryOptions,
    callback: ValueCallback<types.ResultSet>,
  ): void;

  batch(
    queries: Array<string | { query: string; params?: ArrayOrObject }>,
    callback: ValueCallback<types.ResultSet>,
  ): void;

  shutdown(): Promise<void>;

  shutdown(callback: EmptyCallback): void;

  getReplicas(keyspace: string, token: Buffer): Host[];

  getState(): metadata.ClientState;
}

export namespace token {
  export { Token, TokenRange };
}
