import { Authenticator, AuthProvider } from "../../auth/provider";

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
declare class DsePlainTextAuthProvider extends AuthProvider {
    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    constructor();

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    newAuthenticator(): Authenticator;
}

export = DsePlainTextAuthProvider;
