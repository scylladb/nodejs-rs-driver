import { Client } from "../../";
import { Readable } from "stream";

export interface ResultSetGroup {
    errors: Error[];
    resultItems: any[];
    totalExecuted: number;
  }

export type Options = {
    collectResults?: boolean;
    concurrencyLevel?: number;
    executionProfile?: string;
    maxErrors?: number;
    raiseOnFirstError?: boolean;
  };

export function executeConcurrent(
  client: Client,
  query: string,
    parameters: any[][] | Readable,
  options?: Options,
): Promise<ResultSetGroup>;

export function executeConcurrent(
  client: Client,
  queries: Array<{ query: string; params: any[] }>,
  options?: Options,
): Promise<ResultSetGroup>;
