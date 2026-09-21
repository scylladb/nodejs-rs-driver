"use strict";

/**
 * Authentication module.
 *
 * Contains the classes used for connecting to databases.
 * @module auth
 */

// Left for compatibility reasons
// TODO: Remove after lib/datastax/deprecated-auth is converted to Typescript.
// @ts-ignore
import DseGssapiAuthProvider = require("../datastax/deprecated-auth/dse-gssapi-auth-provider");
// TODO: Remove after lib/datastax/deprecated-auth is converted to Typescript.
// @ts-ignore
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
