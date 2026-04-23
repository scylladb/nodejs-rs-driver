// @ts-nocheck
"use strict";
const { AuthProvider } = require("../../auth/provider");
const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class DseGssapiAuthProvider extends AuthProvider {
    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    // eslint-disable-next-line constructor-super
    constructor() {
        throwNotSupported("DseGssapiAuthProvider.constructor");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    newAuthenticator() {
        throwNotSupported("DseGssapiAuthProvider.newAuthenticator");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static lookupServiceResolver() {
        throwNotSupported("DseGssapiAuthProvider.lookupServiceResolver");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static reverseDnsResolver() {
        throwNotSupported("DseGssapiAuthProvider.reverseDnsResolver");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static useIpResolver() {
        throwNotSupported("DseGssapiAuthProvider.useIpResolver");
    }
}

module.exports = DseGssapiAuthProvider;
