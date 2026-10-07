"use strict";

/**
 * Authentication module.
 *
 * Contains the classes used for connecting to databases.
 * @module auth
 */

// Left for compatibility reasons
import DseGssapiAuthProvider = require("../datastax/deprecated-auth/dse-gssapi-auth-provider");
import DsePlainTextAuthProvider = require("../datastax/deprecated-auth/dse-plain-text-auth-provider");
import NoAuthProvider = require("./no-auth-provider");
import { Authenticator, AuthProvider } from "./provider";
import { PlainTextAuthProvider } from "./plain-text-auth-provider";

export { AuthenticatorCallback } from "./provider";

export {
    Authenticator,
    AuthProvider,
    DseGssapiAuthProvider,
    DsePlainTextAuthProvider,
    NoAuthProvider,
    PlainTextAuthProvider,
};
