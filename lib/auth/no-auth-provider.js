// @ts-nocheck
"use strict";

const { AuthProvider, Authenticator } = require("./provider");
const errors = require("../errors");

/**
 * Internal authentication provider that is used when no provider has been set by the user.
 * @ignore
 */
class NoAuthProvider extends AuthProvider {
  newAuthenticator(endpoint) {
    // Use an authenticator that doesn't allow auth flow
    return new NoAuthAuthenticator(endpoint);
  }
}

/**
 * An authenticator throws an error when authentication flow is started.
 * @ignore
 */
class NoAuthAuthenticator extends Authenticator {
  constructor(endpoint) {
    super();
    this.endpoint = endpoint;
  }

  initialResponse(callback) {
    callback(
      new errors.AuthenticationError(
        `Host ${this.endpoint} requires authentication, but no authenticator found in the options`,
      ),
    );
  }
}

module.exports = NoAuthProvider;
