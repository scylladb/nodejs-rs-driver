import { ExecutionOptions, Host } from "../../";

export interface RequestTracker {
    onError(
      host: Host,
      query: string | Array<{ query: string; params?: any }>,
      parameters: any[] | { [key: string]: any } | null,
      executionOptions: ExecutionOptions,
      requestLength: number,
      err: Error,
      latency: number[],
    ): void;

    onSuccess(
      host: Host,
      query: string | Array<{ query: string; params?: any }>,
      parameters: any[] | { [key: string]: any } | null,
      executionOptions: ExecutionOptions,
      requestLength: number,
      responseLength: number,
      latency: number[],
    ): void;

    shutdown(): void;
  }

export class RequestLogger implements RequestTracker {
    constructor(options: {
      slowThreshold?: number;
      logNormalRequests?: boolean;
      logErroredRequests?: boolean;
      messageMaxQueryLength?: number;
      messageMaxParameterValueLength?: number;
      messageMaxErrorStackTraceLength?: number;
    });

    onError(
      host: Host,
      query: string | Array<{ query: string; params?: any }>,
      parameters: any[] | { [p: string]: any } | null,
      executionOptions: ExecutionOptions,
      requestLength: number,
      err: Error,
      latency: number[],
    ): void;

    onSuccess(
      host: Host,
      query: string | Array<{ query: string; params?: any }>,
      parameters: any[] | { [p: string]: any } | null,
      executionOptions: ExecutionOptions,
      requestLength: number,
      responseLength: number,
      latency: number[],
    ): void;

    shutdown(): void;
  }
