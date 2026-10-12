import { Authenticator, AuthProvider } from "../../auth/provider";

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
declare class DseGssapiAuthProvider extends AuthProvider {
    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    constructor();

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    newAuthenticator(): Authenticator;

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static lookupServiceResolver(): never;

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static reverseDnsResolver(): never;

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static useIpResolver(): never;
}

export = DseGssapiAuthProvider;
