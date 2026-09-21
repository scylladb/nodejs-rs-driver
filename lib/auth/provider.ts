"use strict";

/**
 * Callback invoked by an {@link Authenticator} with the token to send to the
 * server, or with the error that prevented it from being produced.
 */
export type AuthenticatorCallback = (
    err?: Error | null,
    token?: Buffer,
) => void;

/**
 * Provides [Authenticator]{@link module:auth~Authenticator} instances to be used when connecting to a host.
 * @abstract
 * @alias module:auth~AuthProvider
 */
class AuthProvider {
    /**
     * Returns an [Authenticator]{@link module:auth~Authenticator} instance to be used when connecting to a host.
     * @param endpoint The ip address and port number in the format ip:port
     * @param name Authenticator name
     * @abstract
     */
    newAuthenticator(endpoint: string, name: string): Authenticator {
        throw new Error(
            "This is an abstract class, you must implement newAuthenticator method or " +
                "use another auth provider that inherits from this class",
        );
    }
}

/**
 * Handles SASL authentication with Cassandra servers.
 * Each time a new connection is created and the server requires authentication,
 * a new instance of this class will be created by the corresponding.
 * @alias module:auth~Authenticator
 */
class Authenticator {
    /**
     * Obtain an initial response token for initializing the SASL handshake.
     */
    initialResponse(callback: AuthenticatorCallback): void {
        callback(new Error("Not implemented"));
    }

    /**
     * Evaluates a challenge received from the Server. Generally, this method should callback with
     * no error and no additional params when authentication is complete from the client perspective.
     */
    evaluateChallenge(
        challenge: Buffer,
        callback: AuthenticatorCallback,
    ): void {
        callback(new Error("Not implemented"));
    }

    /**
     * Called when authentication is successful with the last information
     * optionally sent by the server.
     */
    onAuthenticationSuccess(token?: Buffer): void {}
}

export { AuthProvider, Authenticator };
