// @ts-nocheck
"use strict";
const { AuthProvider } = require("../../auth/provider");
const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class DsePlainTextAuthProvider extends AuthProvider {
    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    // eslint-disable-next-line constructor-super
    constructor() {
        throwNotSupported("DsePlainTextAuthProvider.constructor");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    newAuthenticator() {
        throwNotSupported("DsePlainTextAuthProvider.newAuthenticator");
    }
}

module.exports = DsePlainTextAuthProvider;
