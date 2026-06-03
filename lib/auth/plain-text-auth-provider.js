// @ts-nocheck
"use strict";
const provider = require("./provider.js");
const utils = require("../utils");
const AuthProvider = provider.AuthProvider;
const Authenticator = provider.Authenticator;

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
  /**
   * Creates a new instance of the Authenticator provider
   * @param {String} username User name in plain text
   * @param {String} password Password in plain text
   */
  constructor(username, password) {
    super();
    this.username = username;
    this.password = password;
  }
  /**
   * Returns a new [Authenticator]{@link module:auth~Authenticator} instance to be used for plain text authentication.
   * @override
   * @returns {Authenticator}
   */
  newAuthenticator() {
    return new PlainTextAuthenticator(this.username, this.password);
  }
}

/**
 * @ignore
 */
class PlainTextAuthenticator extends Authenticator {
  constructor(username, password) {
    super();
    this.username = username;
    this.password = password;
  }
  initialResponse(callback) {
    const initialToken = Buffer.concat([
      utils.allocBufferFromArray([0]),
      utils.allocBufferFromString(this.username, "utf8"),
      utils.allocBufferFromArray([0]),
      utils.allocBufferFromString(this.password, "utf8"),
    ]);
    callback(null, initialToken);
  }
  evaluateChallenge(challenge, callback) {
    // noop
    callback();
  }
}

module.exports = {
  PlainTextAuthenticator,
  PlainTextAuthProvider,
};
