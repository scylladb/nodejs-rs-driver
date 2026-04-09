"use strict";

/**
 * Authentication module.
 * 
 * Contains the classes used for connecting to databases.
 * @module auth
 */

const { Authenticator, AuthProvider } = require("./provider");
const { PlainTextAuthProvider } = require("./plain-text-auth-provider");
// Left for compatibility reasons
const DseGssapiAuthProvider = require("../datastax/deprecated-auth/dse-gssapi-auth-provider");
const DsePlainTextAuthProvider = require("../datastax/deprecated-auth/dse-plain-text-auth-provider");
const NoAuthProvider = require("./no-auth-provider");

module.exports = {
    Authenticator,
    AuthProvider,
    DseGssapiAuthProvider,
    DsePlainTextAuthProvider,
    NoAuthProvider,
    PlainTextAuthProvider,
};
