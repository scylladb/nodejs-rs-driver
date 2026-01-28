import * as events from "events";
import * as tls from "tls";
import { URL } from "url";
import { auth } from "./lib/auth";
import { policies } from "./lib/policies";
import { types } from "./lib/types";
import { metrics } from "./lib/metrics";
import { tracker } from "./lib/tracker";
import { metadata } from "./lib/metadata";
import Long = types.Long;
import Uuid = types.Uuid;

// Export imported submodules
export { concurrent } from "./lib/concurrent";
export { mapping } from "./lib/mapping";
export { auth, metadata, metrics, policies, tracker, types };

export const version: number;

export function defaultOptions(): ClientOptions;

export type ValueCallback<T> = (err: Error, val: T) => void;
export type EmptyCallback = (err: Error) => void;
export type ArrayOrObject = any[] | { [key: string]: any };

export class Client extends events.EventEmitter {
  hosts: HostMap;
  keyspace: string;
  metadata: metadata.Metadata;
  metrics: metrics.ClientMetrics;

  constructor(options: DseClientOptions);

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

export interface HostMap extends events.EventEmitter {
  length: number;

  forEach(callback: (value: Host, key: string) => void): void;

  get(key: string): Host;

  keys(): string[];

  values(): Host[];
}

export interface Host extends events.EventEmitter {
  address: string;
  cassandraVersion: string;
  datacenter: string;
  rack: string;
  tokens: string[];
  hostId: types.Uuid;

  canBeConsideredAsUp(): boolean;

  getCassandraVersion(): number[];

  isUp(): boolean;
}

export interface ExecutionOptions {
  getCaptureStackTrace(): boolean;

  getConsistency(): types.consistencies;

  getCustomPayload(): { [key: string]: any };

  getFetchSize(): number;

  getFixedHost(): Host;

  getHints(): string[] | string[][];

  isAutoPage(): boolean;

  isBatchCounter(): boolean;

  isBatchLogged(): boolean;

  isIdempotent(): boolean;

  isPrepared(): boolean;

  isQueryTracing(): boolean;

  getKeyspace(): string;

  getLoadBalancingPolicy(): policies.loadBalancing.LoadBalancingPolicy;

  getPageState(): Buffer;

  getRawQueryOptions(): QueryOptions;

  getReadTimeout(): number;

  getRetryPolicy(): policies.retry.RetryPolicy;

  getRoutingKey(): Buffer | Buffer[];

  getSerialConsistency(): types.consistencies;

  getTimestamp(): number | Long | undefined | null;

  setHints(hints: string[]): void;
}

export interface ClientOptions {
  contactPoints?: string[];
  localDataCenter?: string;
  keyspace?: string;
  authProvider?: auth.AuthProvider;
  credentials?: {
    username: string;
    password: string;
  };

  encoding?: {
    map?: Function;
    set?: Function;
    copyBuffer?: boolean;
    useUndefinedAsUnset?: boolean;
    useBigIntAsLong?: boolean;
    useBigIntAsVarint?: boolean;
  };
  isMetadataSyncEnabled?: boolean;
  maxPrepared?: number;
  metrics?: metrics.ClientMetrics;
  policies?: {
    addressResolution?: policies.addressResolution.AddressTranslator;
    loadBalancing?: policies.loadBalancing.LoadBalancingPolicy;
    reconnection?: policies.reconnection.ReconnectionPolicy;
    retry?: policies.retry.RetryPolicy;
    speculativeExecution?: policies.speculativeExecution.SpeculativeExecutionPolicy;
    timestampGeneration?: policies.timestampGeneration.TimestampGenerator;
  };
  pooling?: {
    coreConnectionsPerHost?: { [key: number]: number };
    heartBeatInterval?: number;
    maxRequestsPerConnection?: number;
    warmup?: boolean;
  };
  prepareOnAllHosts?: boolean;
  profiles?: ExecutionProfile[];
  protocolOptions?: {
    maxSchemaAgreementWaitSeconds?: number;
    maxVersion?: number;
    noCompact?: boolean;
    port?: number;
  };
  promiseFactory?: (
    handler: (callback: (err: Error, result?: any) => void) => void,
  ) => Promise<any>;
  queryOptions?: QueryOptions;
  refreshSchemaDelay?: number;
  rePrepareOnUp?: boolean;
  requestTracker?: tracker.RequestTracker;
  socketOptions?: {
    coalescingThreshold?: number;
    connectTimeout?: number;
    defunctReadTimeoutThreshold?: number;
    keepAlive?: boolean;
    keepAliveDelay?: number;
    readTimeout?: number;
    tcpNoDelay?: boolean;
  };
  sslOptions?: SslOptions;
}

export interface SslOptions {
  ca?: string | Buffer | Array<string | Buffer>;
  cert?: string | Buffer;
  sigalgs?: string;
  ciphers?: string;
  ecdhCurve?: string;
  honorCipherOrder?: boolean;
  key?: string | Buffer;
  maxVersion?: tls.SecureVersion;
  minVersion?: tls.SecureVersion;
  secureOptions?: number;
  sessionIdContext?: string;
  rejectUnauthorized?: boolean;
}

export interface QueryOptions {
  autoPage?: boolean;
  captureStackTrace?: boolean;
  consistency?: number;
  counter?: boolean;
  customPayload?: any;
  executionProfile?: string | ExecutionProfile;
  fetchSize?: number;
  hints?: string[] | string[][];
  host?: Host;
  isIdempotent?: boolean;
  keyspace?: string;
  logged?: boolean;
  pageState?: Buffer | string;
  prepare?: boolean;
  readTimeout?: number;
  retry?: policies.retry.RetryPolicy;
  routingIndexes?: number[];
  routingKey?: Buffer | Buffer[];
  routingNames?: string[];
  serialConsistency?: number;
  timestamp?: number | Long;
  traceQuery?: boolean;
}

export interface DseClientOptions extends ClientOptions {
  id?: Uuid;
  applicationName?: string;
  applicationVersion?: string;
  monitorReporting?: { enabled?: boolean };
}

export class ExecutionProfile {
  consistency?: types.consistencies;
  loadBalancing?: policies.loadBalancing.LoadBalancingPolicy;
  name: string;
  readTimeout?: number;
  retry?: policies.retry.RetryPolicy;
  serialConsistency?: types.consistencies;

  constructor(
    name: string,
    options: {
      consistency?: types.consistencies;
      loadBalancing?: policies.loadBalancing.LoadBalancingPolicy;
      readTimeout?: number;
      retry?: policies.retry.RetryPolicy;
      serialConsistency?: types.consistencies;
    },
  );
}

export namespace errors {
  class ArgumentError extends DriverError {
    constructor(message: string);
  }

  class AuthenticationError extends DriverError {
    constructor(message: string);
  }

  class BusyConnectionError extends DriverError {
    constructor(
      address: string,
      maxRequestsPerConnection: number,
      connectionLength: number,
    );
  }

  abstract class DriverError extends Error {
    info: string;

    constructor(message: string, constructor?: any);
  }

  class DriverInternalError extends DriverError {
    constructor(message: string);
  }

  class NoHostAvailableError extends DriverError {
    innerErrors: any;

    constructor(innerErrors: any, message?: string);
  }

  class NotSupportedError extends DriverError {
    constructor(message: string);
  }

  class OperationTimedOutError extends DriverError {
    host?: string;

    constructor(message: string, host?: string);
  }

  class ResponseError extends DriverError {
    code: number;

    constructor(code: number, message: string);
  }
}

export namespace token {
  interface Token {
    compare(other: Token): number;

    equals(other: Token): boolean;

    getType(): { code: types.dataTypes; info: any };

    getValue(): any;
  }

  interface TokenRange {
    start: Token;
    end: Token;

    compare(other: TokenRange): number;

    contains(token: Token): boolean;

    equals(other: TokenRange): boolean;

    isEmpty(): boolean;

    isWrappedAround(): boolean;

    splitEvenly(numberOfSplits: number): TokenRange[];

    unwrap(): TokenRange[];
  }
}
