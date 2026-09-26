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
    RoundRobinPolicy,
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
        metadataRequestServersideTimeoutSecs: 7,
        metadataRequestClientsideTimeoutSecs: 9,
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

    describe("localDataCenter", function () {
        function loadBalancingConfig(localDataCenter, policy) {
            return setRustOptions({
                localDataCenter,
                policies: { loadBalancing: policy },
            }).loadBalancingConfig;
        }

        it("should configure the default client policy", function () {
            const config = setRustOptions(
                extend({
                    contactPoints: ["127.0.0.1"],
                    localDataCenter: "dc1",
                }),
            ).loadBalancingConfig;

            assert.strictEqual(config.preferDatacenter, "dc1");
            assert.strictEqual(config.permitDcFailover, false);
        });

        it("should configure the default policy when it has no datacenter preference", function () {
            const policy = new DefaultLoadBalancingPolicy({
                tokenAware: false,
            });

            assert.deepStrictEqual(loadBalancingConfig("dc1", policy), {
                tokenAware: false,
                preferDatacenter: "dc1",
                permitDcFailover: false,
            });
        });

        it("should preserve an explicit datacenter failover setting", function () {
            const policy = new DefaultLoadBalancingPolicy({
                permitDcFailover: true,
            });

            assert.deepStrictEqual(loadBalancingConfig("dc1", policy), {
                preferDatacenter: "dc1",
                permitDcFailover: true,
            });
        });

        it("should preserve an explicit policy datacenter preference", function () {
            const policy = new DefaultLoadBalancingPolicy({
                preferDatacenter: "policy-dc",
                permitDcFailover: true,
            });

            assert.deepStrictEqual(loadBalancingConfig("client-dc", policy), {
                preferDatacenter: "policy-dc",
                permitDcFailover: true,
            });
        });

        it("should not mutate a policy reused by clients", function () {
            const policyConfig = Object.freeze({ tokenAware: false });
            const policy = new DefaultLoadBalancingPolicy(policyConfig);

            assert.deepStrictEqual(loadBalancingConfig("dc1", policy), {
                tokenAware: false,
                preferDatacenter: "dc1",
                permitDcFailover: false,
            });
            assert.deepStrictEqual(loadBalancingConfig("dc2", policy), {
                tokenAware: false,
                preferDatacenter: "dc2",
                permitDcFailover: false,
            });
            assert.strictEqual(policy.getRustConfiguration(), policyConfig);
            assert.deepStrictEqual(policyConfig, { tokenAware: false });
        });

        it("should treat a null policy preference as unset", function () {
            const policy = new DefaultLoadBalancingPolicy({
                preferDatacenter: null,
                tokenAware: false,
            });

            assert.deepStrictEqual(loadBalancingConfig("dc1", policy), {
                preferDatacenter: "dc1",
                tokenAware: false,
                permitDcFailover: false,
            });
        });

        it("should not apply to other load balancing policies", function () {
            const policy = new RoundRobinPolicy();

            assert.deepStrictEqual(loadBalancingConfig("dc1", policy), {
                tokenAware: false,
            });
        });

        it("should leave the default policy unchanged without localDataCenter", function () {
            const policyConfig = { tokenAware: false };
            const policy = new DefaultLoadBalancingPolicy(policyConfig);

            assert.strictEqual(
                loadBalancingConfig(undefined, policy),
                policyConfig,
            );
        });
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
