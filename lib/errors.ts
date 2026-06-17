"use strict";
/**
 * Contains the error classes exposed by the driver.
 * @module errors
 */

/**
 * Base Error
 * @private
 */
class DriverError extends Error {
    info: string;

    constructor(message: string) {
        super(message);
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.info = "Cassandra Driver Error";
        // Explicitly set the message property as the Error.call() doesn't set the property on v8.
        this.message = message;
    }
}

/**
 * Represents an error when a query cannot be performed because no host is available or could be reached by the driver.
 */
class NoHostAvailableError extends DriverError {
    innerErrors: { [key: string]: any };

    /**
     * @param innerErrors An object map containing the error per host tried.
     * @param message
     */
    constructor(innerErrors: { [key: string]: any }, message: string) {
        super(message);
        this.innerErrors = innerErrors;
        this.info =
            "Represents an error when a query cannot be performed because no host is available or could be reached by the driver.";
        if (!message) {
            this.message = "All host(s) tried for query failed.";
            if (innerErrors) {
                const hostList = Object.keys(innerErrors);
                if (hostList.length > 0) {
                    const host = hostList[0];
                    this.message += ` First host tried, ${host}: ${innerErrors[host]}. See innerErrors.`;
                }
            }
        }
    }
}

/**
 * Represents an error message from the server.
 */
class ResponseError extends DriverError {
    code: number;

    /**
     * @param code Cassandra exception code as defined in [responseErrorCodes]{@link module:types~responseErrorCodes}.
     * @param message
     */
    constructor(code: number, message: string) {
        super(message);
        this.code = code;
        this.info = "Represents an error message from the server.";
    }
}

/**
 * Represents a bug inside the driver or in a Cassandra host.
 */
class DriverInternalError extends DriverError {
    /**
     * @param message
     */
    constructor(message: string) {
        super(message);
        this.info =
            "Represents a bug inside the driver or in a Cassandra host.";
    }
}

/**
 * Represents an error when trying to authenticate with auth-enabled host.
 */
class AuthenticationError extends DriverError {
    /**
     * @param message
     */
    constructor(message: string) {
        super(message);
        this.info =
            "Represents an authentication error from the driver or from a Cassandra node.";
    }
}

/**
 * Represents an error that is raised when one of the arguments provided to a method is not valid.
 */
class ArgumentError extends DriverError {
    /**
     * @param message
     */
    constructor(message: string) {
        super(message);
        this.info =
            "Represents an error that is raised when one of the arguments provided to a method is not valid.";
    }
}

/**
 * Represents a client-side error that is raised when the client didn't hear back from the server within.
 * {@link ClientOptions.socketOptions.readTimeout}.
 */
class OperationTimedOutError extends DriverError {
    /**
     * When defined, it gets the address of the host that caused the operation to time out.
     */
    host?: string;

    /**
     * @param message
     * @param host Address of the server host that caused the operation to time out.
     */
    constructor(message: string, host?: string) {
        super(message);
        this.info =
            "Represents a client-side error that is raised when the client did not hear back from the server " +
            "within socketOptions.readTimeout";

        this.host = host;
    }
}

/**
 * Represents an error that is raised when a feature is not supported in the driver or in the current Cassandra version.
 */
class NotSupportedError extends DriverError {
    /**
     * @param message
     */
    constructor(message: string) {
        super(message);
        this.info =
            "Represents a feature that is not supported in the driver or in the Cassandra version.";
    }
}

/**
 * Represents a client-side error indicating that all connections to a certain host have reached
 * the maximum amount of in-flight requests supported.
 */
class BusyConnectionError extends DriverError {
    /**
     * @param address
     * @param maxRequestsPerConnection
     * @param connectionLength
     */
    constructor(
        address: string,
        maxRequestsPerConnection: number,
        connectionLength: number,
    ) {
        const message = `All connections to host ${address} are busy, ${maxRequestsPerConnection} requests are in-flight on ${connectionLength === 1 ? "a single connection" : "each connection"}`;
        super(message);
        this.info =
            "Represents a client-side error indicating that all connections to a certain host have reached " +
            "the maximum amount of in-flight requests supported (pooling.maxRequestsPerConnection).";
    }
}

export {
    ArgumentError,
    AuthenticationError,
    BusyConnectionError,
    DriverError,
    OperationTimedOutError,
    DriverInternalError,
    NoHostAvailableError,
    NotSupportedError,
    ResponseError,
};
