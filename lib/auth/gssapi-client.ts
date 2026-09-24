"use strict";

import util = require("util");
import utils = require("../utils");

/**
 * Callback invoked with the token to send to the server, or with the error
 * that prevented it from being produced.
 */
type GssapiCallback = (err?: Error | null, response?: Buffer) => void;

/**
 * Callback invoked with the result of a single step of the handshake.
 *
 * The response is the base64 representation of the token, as produced by the
 * kerberos module. {@link StandardGssClient.transition2} reports a failure as
 * `false`, which the caller ignores in favour of the error.
 */
type TransitionCallback = (
    err?: Error | null,
    response?: string | false,
) => void;

/**
 * GSSAPI Client interface.
 * @ignore
 */
class GssapiClient {
    authorizationId?: string;
    service: string;

    constructor(authorizationId?: string, service?: string) {
        this.authorizationId = authorizationId;
        this.service = service !== undefined ? service : "dse";
    }

    /**
     * @abstract
     * @param host Host name or ip
     */
    init(host: string, callback: GssapiCallback): void {
        throw new Error("Not implemented");
    }

    /**
     * @abstract
     */
    evaluateChallenge(challenge: Buffer, callback: GssapiCallback): void {
        throw new Error("Not implemented");
    }

    /**
     * @abstract
     */
    shutdown(callback: GssapiCallback): void {
        throw new Error("Not implemented");
    }

    /**
     * Factory to get the actual implementation of GSSAPI (unix or win)
     * @param kerberosModule Kerberos client library dependency
     * @param authorizationId An identity to act as (for proxy authentication).
     * @param service The service to use. (defaults to 'dse')
     */
    static createNew(
        kerberosModule: any,
        authorizationId?: string,
        service?: string,
    ): GssapiClient {
        return new StandardGssClient(kerberosModule, authorizationId, service);
    }
}

/**
 * GSSAPI Client implementation using kerberos module.
 * @ignore
 */
class StandardGssClient extends GssapiClient {
    kerberos: any;
    kerberosClient: any;
    transitionIndex: number;
    host?: string;

    constructor(
        kerberosModule: any,
        authorizationId?: string,
        service?: string,
    ) {
        if (typeof kerberosModule.initializeClient !== "function") {
            throw new Error(
                "The driver expects version 1.x of the kerberos library",
            );
        }

        super(authorizationId, service);
        this.kerberos = kerberosModule;
        this.transitionIndex = 0;
    }

    init(host: string, callback: GssapiCallback): void {
        this.host = host;
        let uri = this.service;
        if (this.host) {
            // For the principal    "dse/cassandra1.datastax.com@DATASTAX.COM"
            // the expected uri is: "dse@cassandra1.datastax.com"
            uri = util.format("%s@%s", this.service, this.host);
        }
        const options = {
            gssFlags: this.kerberos.GSS_C_MUTUAL_FLAG, // authenticate itself flag
        };
        this.kerberos.initializeClient(
            uri,
            options,
            (err: Error | null, kerberosClient: any) => {
                if (err) {
                    return callback(err);
                }
                this.kerberosClient = kerberosClient;
                callback();
            },
        );
    }

    /** @override */
    evaluateChallenge(challenge: Buffer, callback: GssapiCallback): void {
        const transition: (
            challenge: Buffer,
            callback: TransitionCallback,
        ) => void = (this as any)["transition" + this.transitionIndex];
        transition.call(this, challenge, (err, response) => {
            if (err) {
                return callback(err);
            }
            this.transitionIndex++;
            callback(
                null,
                response
                    ? utils.allocBufferFromString(response, "base64")
                    : utils.allocBuffer(0),
            );
        });
    }

    transition0(challenge: Buffer, callback: TransitionCallback): void {
        this.kerberosClient.step("", callback);
    }

    transition1(challenge: Buffer, callback: TransitionCallback): void {
        const charPointerChallenge = challenge.toString("base64");
        this.kerberosClient.step(charPointerChallenge, callback);
    }

    transition2(challenge: Buffer, callback: TransitionCallback): void {
        this.kerberosClient.unwrap(
            challenge.toString("base64"),
            (err: Error | null, response: string) => {
                if (err) {
                    return callback(err, false);
                }
                const cb = function (err: Error | null, wrapped: string) {
                    if (err) {
                        return callback(err);
                    }
                    callback(null, wrapped);
                };
                if (this.authorizationId !== undefined) {
                    this.kerberosClient.wrap(
                        response,
                        { user: this.authorizationId },
                        cb,
                    );
                } else {
                    this.kerberosClient.wrap(response, null, cb);
                }
            },
        );
    }

    shutdown(callback: GssapiCallback): void {
        this.kerberosClient = null;
        callback();
    }
}

export = GssapiClient;
