"use strict";

const net = require("node:net");
const { assert } = require("chai");
const rust = require("../../index");
const { setRustOptions, extend } = require("../../lib/client-options");
const {
    MappingAddressTranslator,
} = require("../../lib/policies/address-resolution");
const {
    DefaultLoadBalancingPolicy,
} = require("../../lib/policies/load-balancing");
const { RetryPolicy } = require("../../lib/policies/retry");
const { Uuid } = require("../../lib/types");
const { PlainTextAuthProvider } = require("../../lib/auth");

const resolutionMap = new Map([
    [
        new net.SocketAddress({ address: "2.1.3.7", port: 690 }),
        new net.SocketAddress({ address: "7.3.1.2", port: 960 }),
    ],
]);

const options = {
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
    protocolOptions: {
        maxSchemaAgreementWaitSeconds: 5,
        autoAwaitSchemaAgreement: false,
    },
};

// Since some of the options can be represented as multiple types,
// this object can be used for those alternative representations
const optionsV2 = {
    contactPoints: ["192.168.0.1"],
    id: Uuid.fromString("21377312-6969-4200-abcd-01234567890a"),
    authProvider: new PlainTextAuthProvider(
        "Unique username v2",
        "Unique password v2",
    ),
};

describe("Client options", function () {
    it("should correctly convert client options", function () {
        rust.testsCheckClientOption(setRustOptions(options), 1);
        rust.testsCheckClientOption(setRustOptions(optionsV2), 3);
    });
    it("should correctly verify full client options", function () {
        extend(options);
        extend(optionsV2);
    });
    it("should correctly convert empty client options", function () {
        let options = {};
        rust.testsCheckClientOption(setRustOptions(options), 2);
    });
    it("should correctly verify empty client options", function () {
        extend({ contactPoints: ["1.1.1.1"] });
    });

    describe("protocolOptions.port", function () {
        function connectPointsFor(contactPoints, port) {
            return setRustOptions({
                contactPoints,
                protocolOptions: { port },
            }).connectPoints;
        }

        it("should append the port to a contact point without one", function () {
            assert.deepStrictEqual(
                connectPointsFor(["127.0.0.1", "db.example.com"], 9142),
                ["127.0.0.1:9142", "db.example.com:9142"],
            );
        });

        it("should leave a contact point that already specifies a port", function () {
            assert.deepStrictEqual(connectPointsFor(["127.0.0.1:9043"], 9142), [
                "127.0.0.1:9043",
            ]);
        });

        it("should bracket a bare IPv6 address before appending the port", function () {
            assert.deepStrictEqual(connectPointsFor(["::1"], 9142), [
                "[::1]:9142",
            ]);
        });

        it("should append the port to a bracketed IPv6 address without one", function () {
            assert.deepStrictEqual(connectPointsFor(["[::1]"], 9142), [
                "[::1]:9142",
            ]);
        });

        it("should leave a bracketed IPv6 contact point that already specifies a port", function () {
            assert.deepStrictEqual(connectPointsFor(["[::1]:9043"], 9142), [
                "[::1]:9043",
            ]);
        });

        it("should apply the default port when protocolOptions is not set", function () {
            assert.deepStrictEqual(
                setRustOptions(extend({ contactPoints: ["127.0.0.1"] }))
                    .connectPoints,
                ["127.0.0.1:9042"],
            );
        });

        it("should reject a port outside the valid range", function () {
            assert.throws(
                () =>
                    extend({
                        contactPoints: ["127.0.0.1"],
                        protocolOptions: { port: 65536 },
                    }),
                TypeError,
            );
        });

        it("should reject a port that is not an integer", function () {
            assert.throws(
                () =>
                    extend({
                        contactPoints: ["127.0.0.1"],
                        protocolOptions: { port: "9042" },
                    }),
                TypeError,
            );
        });
    });
});
