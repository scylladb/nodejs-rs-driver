import * as types from "../types";
import { EmptyCallback, Host, token, ValueCallback } from "../../";
import { CqlType } from "../../index";
import { SessionWrapper as RustClient } from "../../index";
import {
  KeyspaceMetadata,
  SimpleStrategy,
  NetworkTopologyStrategy,
  LocalStrategy,
  OtherStrategy,
} from "../../index";
import { StrategyKind, Strategy } from "./strategy";

import {
  TableMetadata,
  ColumnMetadata,
  ColumnKind,
} from "./table-metadata";
export {
  TableMetadata,
  ColumnMetadata,
  ColumnKind,
};

import dataTypes = types.dataTypes;
import Uuid = types.Uuid;
import InetAddress = types.InetAddress;

export {
  KeyspaceMetadata,
  SimpleStrategy,
  NetworkTopologyStrategy,
  LocalStrategy,
  OtherStrategy,
  StrategyKind,
  Strategy,
};

export interface Aggregate {
  argumentTypes: Array<{ code: dataTypes; info: any }>;
  finalFunction: string;
  initCondition: string;
  keyspaceName: string;
  returnType: string;
  signature: string[];
  stateFunction: string;
  stateType: string;
}

export interface ClientState {
  getConnectedHosts(): Host[];

  getInFlightQueries(host: Host): number;

  getOpenConnections(host: Host): number;

  toString(): string;
}

export interface ColumnInfoOptions {
  frozen?: boolean;
  reversed?: boolean;
}

export interface UdtInfo {
  name: string;
  keyspace: string;
  fields: UdtField[];
}

/**
 * Describes CQL column type information.
 *
 * The `info` field varies depending on the type code:
 * - Simple types: `info` is `null`
 * - List/Set: `info` is a `ColumnInfo` for the element type
 * - Map: `info` is a tuple `[ColumnInfo, ColumnInfo]` for key and value types
 * - Tuple: `info` is an array of `ColumnInfo` for each element
 * - UDT: `info` is a `UdtInfo` with name and fields
 * - Vector (custom): `info` is a tuple `[ColumnInfo, number]` for element type and dimension
 * - Other custom: `info` is a string
 */
export interface ColumnInfo {
  code: CqlType;
  info:
    | null
    | ColumnInfo
    | [ColumnInfo, ColumnInfo]
    | ColumnInfo[]
    | UdtInfo
    | [ColumnInfo, number]
    | string;
  options?: ColumnInfoOptions;
  customTypeName?: string;
}

export enum IndexKind {
  custom = 0,
  keys,
  composites,
}

export interface Index {
  kind: IndexKind;
  name: string;
  options: object;
  target: string;

  isCompositesKind(): boolean;

  isCustomKind(): boolean;

  isKeysKind(): boolean;
}

export interface MaterializedView extends TableMetadata {
  tableName: string;
}

export interface QueryTrace {
  requestType: string;
  coordinator: InetAddress;
  parameters: { [key: string]: any };
  startedAt: number | types.Long;
  duration: number;
  clientAddress: string;
  events: Array<{
    id: Uuid;
    activity: any;
    source: any;
    elapsed: any;
    thread: any;
  }>;
}

export interface SchemaFunction {
  argumentNames: string[];
  argumentTypes: Array<{ code: dataTypes; info: any }>;
  body: string;
  calledOnNullInput: boolean;
  keyspaceName: string;
  language: string;
  name: string;
  returnType: string;
  signature: string[];
}

export interface UdtField {
  name: string;
  type: ColumnInfo;
}

export interface Udt {
  name: string;
  keyspace: string;
  fields: UdtField[];
}

export class Metadata {
  constructor(client: RustClient);

  getKeyspace(name: string): KeyspaceMetadata | null;

  getKeyspaces(): Map<string, KeyspaceMetadata>;

  getTable(
    keyspaceName: string,
    name: string,
  ): TableMetadata | null;

  getMaterializedView(
    keyspaceName: string,
    name: string,
  ): MaterializedView | null;

  getUdt(keyspaceName: string, name: string): Udt | null;

  getAggregate(
    keyspaceName: string,
    name: string,
    signature: string[] | Array<{ code: number; info: any }>,
  ): Aggregate | null;

  getAggregates(
    keyspaceName: string,
    name: string,
  ): Aggregate[];

  getFunction(
    keyspaceName: string,
    name: string,
    signature: string[] | Array<{ code: number; info: any }>,
  ): SchemaFunction | null;

  getFunctions(
    keyspaceName: string,
    name: string,
  ): SchemaFunction[];

  getTrace(
    traceId: Uuid,
    consistency?: types.consistencies,
  ): QueryTrace | null;

  getReplicas(
    keyspaceName: string,
    token: Buffer | token.Token | token.TokenRange,
  ): Host[];

  getTokenRanges(): Set<token.TokenRange>;

  getTokenRangesForHost(
    keyspaceName: string,
    host: Host,
  ): Set<token.TokenRange> | null;

  newToken(components: Buffer[] | Buffer | string): token.Token;

  newTokenRange(start: token.Token, end: token.Token): token.TokenRange;

  checkSchemaAgreement(): Boolean;
}
