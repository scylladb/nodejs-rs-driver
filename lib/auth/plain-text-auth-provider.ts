"use strict";

import { AuthProvider, Authenticator, AuthenticatorCallback } from "./provider";
import utils = require("../utils");

/**
 * Provides plain text [Authenticator]{@link module:auth~Authenticator} instances to be used when
 * connecting to a host.
 * @extends module:auth~AuthProvider
 * @example
 * var authProvider = new cassandra.auth.PlainTextAuthProvider('my_user', 'p@ssword1!');
 * //Set the auth provider in the clientOptions when creating the Client instance
 * const client = new Client({ contactPoints: contactPoints, authProvider: authProvider });
 * @alias module:auth~PlainTextAuthProvider
 */
class PlainTextAuthProvider extends AuthProvider {
    username: string;
    password: string;

    /**
     * Creates a new instance of the Authenticator provider
     * @param username User name in plain text
     * @param password Password in plain text
     */
    constructor(username: string, password: string) {
        super();
        this.username = username;
        this.password = password;
    }

    /**
     * Returns a new [Authenticator]{@link module:auth~Authenticator} instance to be used for plain text authentication.
     * @override
     */
    newAuthenticator(endpoint: string, name: string): Authenticator {
        return new PlainTextAuthenticator(this.username, this.password);
    }
}

/**
 * @ignore
 */
class PlainTextAuthenticator extends Authenticator {
    username: string;
    password: string;

    constructor(username: string, password: string) {
        super();
        this.username = username;
        this.password = password;
    }

    initialResponse(callback: AuthenticatorCallback): void {
        const initialToken = Buffer.concat([
            utils.allocBufferFromArray([0]),
            utils.allocBufferFromString(this.username, "utf8"),
            utils.allocBufferFromArray([0]),
            utils.allocBufferFromString(this.password, "utf8"),
        ]);
        callback(null, initialToken);
    }

    evaluateChallenge(
        challenge: Buffer,
        callback: AuthenticatorCallback,
    ): void {
        // noop
        callback();
    }
}

export { PlainTextAuthenticator, PlainTextAuthProvider };
