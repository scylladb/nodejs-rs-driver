import * as types from "../types";
import { Client } from "../../";
import Long = types.Long;

export interface TableMappings {
    getColumnName(propName: string): string;

    getPropertyName(columnName: string): string;

    newObjectInstance(): any;
  }

export class DefaultTableMappings implements TableMappings {
    getColumnName(propName: string): string;

    getPropertyName(columnName: string): string;

    newObjectInstance(): any;
  }

export class UnderscoreCqlToCamelCaseMappings implements TableMappings {
    getColumnName(propName: string): string;

    getPropertyName(columnName: string): string;

    newObjectInstance(): any;
  }

export interface Result<T = any> extends Iterator<T> {
    wasApplied(): boolean;

    first(): T | null;

    forEach(
      callback: (currentValue: T, index: number) => void,
      thisArg?: any,
    ): void;

    toArray(): T[];
  }

export type MappingExecutionOptions = {
    executionProfile?: string;
    isIdempotent?: boolean;
    logged?: boolean;
    timestamp?: number | Long;
    fetchSize?: number;
    pageState?: number;
  };

export interface ModelTables {
    name: string;
    isView: boolean;
  }

export class Mapper {
    constructor(client: Client, options?: MappingOptions);

    batch(
      items: ModelBatchItem[],
      executionOptions?: string | MappingExecutionOptions,
    ): Promise<Result>;

    forModel<T = any>(name: string): ModelMapper<T>;
  }

export type MappingOptions = {
    models: { [key: string]: ModelOptions };
  };

export type FindDocInfo = {
    fields?: string[];
    orderBy?: { [key: string]: string };
    limit?: number;
  };

export type InsertDocInfo = {
    fields?: string[];
    ttl?: number;
    ifNotExists?: boolean;
  };

export type UpdateDocInfo = {
    fields?: string[];
    ttl?: number;
    ifExists?: boolean;
    when?: { [key: string]: any };
    orderBy?: { [key: string]: string };
    limit?: number;
    deleteOnlyColumns?: boolean;
  };

export type RemoveDocInfo = {
    fields?: string[];
    ttl?: number;
    ifExists?: boolean;
    when?: { [key: string]: any };
    deleteOnlyColumns?: boolean;
  };

export type ModelOptions = {
    tables?: string[] | ModelTables[];
    mappings?: TableMappings;
    columns?: { [key: string]: string | ModelColumnOptions };
    keyspace?: string;
  };

export type ModelColumnOptions = {
    name: string;
    toModel?: (columnValue: any) => any;
    fromModel?: (modelValue: any) => any;
  };

export interface ModelBatchItem {}

export interface ModelBatchMapper {
    insert(doc: any, docInfo?: InsertDocInfo): ModelBatchItem;

    remove(doc: any, docInfo?: RemoveDocInfo): ModelBatchItem;

    update(doc: any, docInfo?: UpdateDocInfo): ModelBatchItem;
  }

export interface ModelMapper<T = any> {
    name: string;
    batching: ModelBatchMapper;

    get(
      doc: { [key: string]: any },
      docInfo?: { fields?: string[] },
      executionOptions?: string | MappingExecutionOptions,
    ): Promise<null | T>;

    find(
      doc: { [key: string]: any },
      docInfo?: FindDocInfo,
      executionOptions?: string | MappingExecutionOptions,
    ): Promise<Result<T>>;

    findAll(
      docInfo?: FindDocInfo,
      executionOptions?: string | MappingExecutionOptions,
    ): Promise<Result<T>>;

    insert(
      doc: { [key: string]: any },
      docInfo?: InsertDocInfo,
      executionOptions?: string | MappingExecutionOptions,
    ): Promise<Result<T>>;

    update(
      doc: { [key: string]: any },
      docInfo?: UpdateDocInfo,
      executionOptions?: string | MappingExecutionOptions,
    ): Promise<Result<T>>;

    remove(
      doc: { [key: string]: any },
      docInfo?: RemoveDocInfo,
      executionOptions?: string | MappingExecutionOptions,
    ): Promise<Result<T>>;

    mapWithQuery(
      query: string,
      paramsHandler: (doc: any) => any[],
      executionOptions?: string | MappingExecutionOptions,
    ): (
      doc: any,
      executionOptions?: string | MappingExecutionOptions,
    ) => Promise<Result<T>>;
  }

export namespace q {
    interface QueryOperator {}

    function in_(arr: any): QueryOperator;

    function gt(value: any): QueryOperator;

    function gte(value: any): QueryOperator;

    function lt(value: any): QueryOperator;

    function lte(value: any): QueryOperator;

    function notEq(value: any): QueryOperator;

    function and(condition1: any, condition2: any): QueryOperator;

    function incr(value: any): QueryOperator;

    function decr(value: any): QueryOperator;

    function append(value: any): QueryOperator;

    function prepend(value: any): QueryOperator;

    function remove(value: any): QueryOperator;
  }
