"use strict";

const assert = require("assert");
const net = require("node:net");
const rust = require("../../index");
const { extend, setRustOptions } = require("../../lib/client-options");
const {
    MappingAddressTranslator,
} = require("../../lib/policies/address-resolution");
const {
    DefaultLoadBalancingPolicy,
} = require("../../lib/policies/load-balancing");
const { RetryPolicy } = require("../../lib/policies/retry");

describe("Client options", function () {
    it("should correctly convert client options", function () {
        let resolutionMap = new Map([
            [
                new net.SocketAddress({ address: "2.1.3.7", port: 690 }),
                new net.SocketAddress({ address: "7.3.1.2", port: 960 }),
            ],
        ]);
        let options = {
            contactPoints: ["Contact point 1", "Contact point 2"],
            keyspace: "keyspace name",
            applicationName: "App name",
            applicationVersion: "App version",
            id: "Client id",
            maxPrepared: 2137,
            credentials: {
                username: "Unique username",
                password: "Unique password",
            },
            sslOptions: {
                ca: ["CA cert 1", "CA cert 2"],
                cert: "Cert chain",
                sigalgs: "RSA+SHA256",
                ciphers: "TLS_AES_128_GCM_SHA256",
                ecdhCurve: "P-256",
                honorCipherOrder: true,
                key: "Private key",
                maxVersion: "TLSv1.3",
                minVersion: "TLSv1.2",
                passphrase: "Passphrase",
                secureOptions: 123,
                rejectUnauthorized: false,
            },
            policies: {
                loadBalancing: new DefaultLoadBalancingPolicy({
                    preferDatacenter: "Magic DC",
                    preferRack: "Rack spec",
                    tokenAware: true,
                    permitDcFailover: false,
                    enableShufflingReplicas: false,
                    allowList: ["127.0.0.1:7312"],
                }),
                retry: new RetryPolicy(),
                addressResolution: new MappingAddressTranslator(resolutionMap),
            },
            socketOptions: {
                connectTimeout: 3000,
                tcpNoDelay: false,
                keepAlive: true,
                keepAliveDelay: 5000,
            },
            pooling: {
                heartBeatInterval: 15000,
            },
            protocolOptions: {
                maxSchemaAgreementWaitSeconds: 20,
                port: 9043,
            },
            refreshSchemaDelay: 500,
        };
        rust.testsCheckClientOption(setRustOptions(options), 1);
    });
    it("should correctly convert empty client options", function () {
        let options = {};
        rust.testsCheckClientOption(setRustOptions(options), 2);
    });

    it("should disable rust keepalive when heartBeatInterval is 0", function () {
        let options = {
            pooling: {
                heartBeatInterval: 0,
            },
        };
        rust.testsCheckClientOption(setRustOptions(options), 3);
    });

    it("should not append the default port to contact points with explicit ports", function () {
        const options = extend({
            contactPoints: ["172.17.0.2:9042"],
        });

        const rustOptions = setRustOptions(options);

        assert.strictEqual(rustOptions.defaultPort, undefined);
        assert.deepStrictEqual(rustOptions.connectPoints, ["172.17.0.2:9042"]);
    });
});
