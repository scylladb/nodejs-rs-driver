import { errors } from "../../";

export interface ClientMetrics {
    onAuthenticationError(e: Error | errors.AuthenticationError): void;

    onClientTimeoutError(e: errors.OperationTimedOutError): void;

    onClientTimeoutRetry(e: Error): void;

    onConnectionError(e: Error): void;

    onIgnoreError(e: Error): void;

    onOtherError(e: Error): void;

    onOtherErrorRetry(e: Error): void;

    onReadTimeoutError(e: errors.ResponseError): void;

    onReadTimeoutRetry(e: Error): void;

    onResponse(latency: number[]): void;

    onSpeculativeExecution(): void;

    onSuccessfulResponse(latency: number[]): void;

    onUnavailableError(e: errors.ResponseError): void;

    onUnavailableRetry(e: Error): void;

    onWriteTimeoutError(e: errors.ResponseError): void;

    onWriteTimeoutRetry(e: Error): void;
  }

export class DefaultMetrics implements ClientMetrics {
    constructor();

    onAuthenticationError(e: Error | errors.AuthenticationError): void;

    onClientTimeoutError(e: errors.OperationTimedOutError): void;

    onClientTimeoutRetry(e: Error): void;

    onConnectionError(e: Error): void;

    onIgnoreError(e: Error): void;

    onOtherError(e: Error): void;

    onOtherErrorRetry(e: Error): void;

    onReadTimeoutError(e: errors.ResponseError): void;

    onReadTimeoutRetry(e: Error): void;

    onResponse(latency: number[]): void;

    onSpeculativeExecution(): void;

    onSuccessfulResponse(latency: number[]): void;

    onUnavailableError(e: errors.ResponseError): void;

    onUnavailableRetry(e: Error): void;

    onWriteTimeoutError(e: errors.ResponseError): void;

    onWriteTimeoutRetry(e: Error): void;
  }
