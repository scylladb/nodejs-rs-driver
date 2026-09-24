"use strict";

import { AuthProvider, Authenticator, AuthenticatorCallback } from "./provider";
import errors = require("../errors");

/**
 * Internal authentication provider that is used when no provider has been set by the user.
 * @ignore
 */
class NoAuthProvider extends AuthProvider {
    newAuthenticator(endpoint: string): Authenticator {
        // Use an authenticator that doesn't allow auth flow
        return new NoAuthAuthenticator(endpoint);
    }
}

/**
 * An authenticator throws an error when authentication flow is started.
 * @ignore
 */
class NoAuthAuthenticator extends Authenticator {
    endpoint: string;

    constructor(endpoint: string) {
        super();
        this.endpoint = endpoint;
    }

    initialResponse(callback: AuthenticatorCallback): void {
        callback(
            new errors.AuthenticationError(
                `Host ${this.endpoint} requires authentication, but no authenticator found in the options`,
            ),
        );
    }
}

export = NoAuthProvider;
