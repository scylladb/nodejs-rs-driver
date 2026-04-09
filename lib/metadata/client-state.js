// @ts-nocheck
"use strict";

let deprecatedMsg =
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
    constructor(_hosts, _openConnections, _inFlightQueries) {
        this.log("warning", deprecatedMsg);
    }

    getConnectedHosts() {
        this.log("warning", deprecatedMsg);
        return [];
    }

    getOpenConnections(_host) {
        this.log("warning", deprecatedMsg);
        return 0;
    }

    getInFlightQueries(_host) {
        this.log("warning", deprecatedMsg);
        return 0;
    }

    toString() {
        this.log("warning", deprecatedMsg);
        return "";
    }

    static from(_client) {
        this.log("warning", deprecatedMsg);
    }
}

module.exports = ClientState;
