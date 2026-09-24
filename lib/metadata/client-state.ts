"use strict";

import { Host } from "../host";
import utils = require("../utils");

const deprecatedMsg =
    "Client state is deprecated and currently provides no functionality!";

/**
 * Represents the state of a {@link Client}.
 *
 * Exposes information on the connections maintained by a Client at a specific time.
 * @alias module:metadata~ClientState
 * @deprecated This is not planned feature for the driver. Currently this remains in place, but contains no information.
 * This may be removed at any point.
 */
class ClientState {
    log = utils.log;

    /**
     * @internal
     * @ignore
     */
    constructor(
        _hosts?: unknown,
        _openConnections?: unknown,
        _inFlightQueries?: unknown,
    ) {
        this.log("warning", deprecatedMsg, undefined, undefined);
    }

    getConnectedHosts(): Host[] {
        this.log("warning", deprecatedMsg, undefined, undefined);
        return [];
    }

    getOpenConnections(_host: Host): number {
        this.log("warning", deprecatedMsg, undefined, undefined);
        return 0;
    }

    getInFlightQueries(_host: Host): number {
        this.log("warning", deprecatedMsg, undefined, undefined);
        return 0;
    }

    toString(): string {
        this.log("warning", deprecatedMsg, undefined, undefined);
        return "";
    }

    static from(_client: unknown): ClientState {
        return new ClientState();
    }
}

export = ClientState;
