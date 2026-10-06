"use strict";

const net = require("node:net");
const { assert } = require("chai");
const rust = require("../../index");
const { setRustOptions, extend } = require("../../lib/client-options");
const {
    MappingAddressTranslator,
} = require("../../lib/policies/address-resolution");
const {
    AllowListPolicy,
    DCAwareRoundRobinPolicy,
    DefaultLoadBalancingPolicy,
    RoundRobinPolicy,
    TokenAwarePolicy,
} = require("../../lib/policies/load-balancing");
const { defaultLoadBalancingPolicy } = require("../../lib/policies");
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
    driverConfigReportingEnabled: false,
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

    describe("driverConfigReportingEnabled", function () {
        it("should be enabled by default and forwarded to Rust", function () {
            const extended = extend({ contactPoints: ["127.0.0.1"] });

            assert.strictEqual(extended.driverConfigReportingEnabled, true);
            assert.strictEqual(
                setRustOptions(extended).driverConfigReportingEnabled,
                true,
            );
        });

        it("should forward an explicit opt-out to Rust", function () {
            const extended = extend({
                contactPoints: ["127.0.0.1"],
                driverConfigReportingEnabled: false,
            });

            assert.strictEqual(
                setRustOptions(extended).driverConfigReportingEnabled,
                false,
            );
        });

        it("should use the default when explicitly undefined", function () {
            const extended = extend({
                contactPoints: ["127.0.0.1"],
                driverConfigReportingEnabled: undefined,
            });

            assert.strictEqual(extended.driverConfigReportingEnabled, true);
            assert.strictEqual(
                setRustOptions(extended).driverConfigReportingEnabled,
                true,
            );
        });

        it("should reject a non-boolean value", function () {
            assert.throws(
                () =>
                    extend({
                        contactPoints: ["127.0.0.1"],
                        driverConfigReportingEnabled: "false",
                    }),
                /driverConfigReportingEnabled must be a boolean value/,
            );
        });
    });

    describe("localDataCenter", function () {
        function rustOptions(localDataCenter, policy) {
            return setRustOptions({
                localDataCenter,
                policies: { loadBalancing: policy },
            });
        }

        it("should forward localDataCenter separately from the default client policy", function () {
            const extended = extend({
                contactPoints: ["127.0.0.1"],
                localDataCenter: "dc1",
            });
            const policyConfig =
                extended.policies.loadBalancing.getRustConfiguration();
            const nativeOptions = setRustOptions(extended);
            const config = nativeOptions.loadBalancingConfig;

            assert.deepStrictEqual(config, policyConfig);
            assert.strictEqual(config.preferDatacenter, undefined);
            assert.strictEqual(config.permitDcFailover, undefined);
            assert.strictEqual(nativeOptions.localDataCenter, "dc1");
            rust.testsCheckClientOption(nativeOptions, 4);
        });

        it("should allow an omitted or undefined value", function () {
            assert.doesNotThrow(() => extend({ contactPoints: ["127.0.0.1"] }));
            assert.doesNotThrow(() =>
                extend({
                    contactPoints: ["127.0.0.1"],
                    localDataCenter: undefined,
                }),
            );
        });

        it("should reject null, empty, and non-string values", function () {
            for (const localDataCenter of [null, "", 1, {}, []]) {
                assert.throws(
                    () =>
                        extend({
                            contactPoints: ["127.0.0.1"],
                            localDataCenter,
                        }),
                    TypeError,
                    "localDataCenter must be a non-empty string",
                );
            }
        });

        it("should preserve a non-empty value without trimming it", function () {
            const options = extend({
                contactPoints: ["127.0.0.1"],
                localDataCenter: "  ",
            });

            assert.strictEqual(options.localDataCenter, "  ");
        });

        it("should preserve a default policy's non-null configuration", function () {
            const policyConfig = {
                tokenAware: false,
            };
            const policy = new DefaultLoadBalancingPolicy(policyConfig);
            const nativeOptions = rustOptions("dc1", policy);

            assert.deepStrictEqual(nativeOptions.loadBalancingConfig, {
                tokenAware: false,
            });
            assert.strictEqual(nativeOptions.localDataCenter, "dc1");
        });

        it("should preserve an explicit datacenter failover setting", function () {
            const policy = new DefaultLoadBalancingPolicy({
                permitDcFailover: true,
            });

            const nativeOptions = rustOptions("dc1", policy);

            assert.deepStrictEqual(nativeOptions.loadBalancingConfig, {
                permitDcFailover: true,
            });
            assert.strictEqual(nativeOptions.localDataCenter, "dc1");
        });

        it("should serialize both an explicit policy preference and the shadowed session preference", function () {
            const policy = new DefaultLoadBalancingPolicy({
                preferDatacenter: "policy-dc",
                permitDcFailover: true,
            });

            const nativeOptions = rustOptions("client-dc", policy);

            assert.deepStrictEqual(nativeOptions.loadBalancingConfig, {
                preferDatacenter: "policy-dc",
                permitDcFailover: true,
            });
            assert.strictEqual(nativeOptions.localDataCenter, "client-dc");
            rust.testsCheckClientOption(nativeOptions, 5);
        });

        it("should serialize equal policy and session preferences independently", function () {
            const policy = new DefaultLoadBalancingPolicy({
                preferDatacenter: "dc1",
            });
            const nativeOptions = rustOptions("dc1", policy);

            assert.deepStrictEqual(nativeOptions.loadBalancingConfig, {
                preferDatacenter: "dc1",
            });
            assert.strictEqual(nativeOptions.localDataCenter, "dc1");
        });

        it("should preserve the helper datacenter preference", function () {
            const policy = defaultLoadBalancingPolicy("policy-dc");
            const nativeOptions = rustOptions("client-dc", policy);

            assert.deepStrictEqual(nativeOptions.loadBalancingConfig, {
                preferDatacenter: "policy-dc",
                permitDcFailover: false,
            });
            assert.strictEqual(nativeOptions.localDataCenter, "client-dc");
        });

        it("should treat an empty or null helper datacenter as no preference", function () {
            for (const localDc of ["", null]) {
                const policy = defaultLoadBalancingPolicy(localDc);
                const nativeOptions = rustOptions("client-dc", policy);

                assert.deepStrictEqual(
                    nativeOptions.loadBalancingConfig,
                    defaultLoadBalancingPolicy().getRustConfiguration(),
                );
                assert.strictEqual(nativeOptions.localDataCenter, "client-dc");
            }
        });

        it("should reject invalid helper datacenter preferences", function () {
            for (const localDc of [1, {}, []]) {
                assert.throws(
                    () => defaultLoadBalancingPolicy(localDc),
                    TypeError,
                    "localDc must be a string",
                );
            }
        });

        it("should not mutate a policy reused by clients", function () {
            const policyConfig = Object.freeze({ tokenAware: false });
            const policy = new DefaultLoadBalancingPolicy(policyConfig);

            const dc1Options = rustOptions("dc1", policy);
            const dc2Options = rustOptions("dc2", policy);

            assert.deepStrictEqual(
                dc1Options.loadBalancingConfig,
                policyConfig,
            );
            assert.deepStrictEqual(
                dc2Options.loadBalancingConfig,
                policyConfig,
            );
            assert.strictEqual(dc1Options.localDataCenter, "dc1");
            assert.strictEqual(dc2Options.localDataCenter, "dc2");
            assert.deepStrictEqual(policy.getRustConfiguration(), policyConfig);
            assert.deepStrictEqual(policyConfig, { tokenAware: false });
        });

        it("should normalize a null policy preference as absent", function () {
            const policyConfig = {
                preferDatacenter: null,
                tokenAware: false,
            };
            const policy = new DefaultLoadBalancingPolicy(policyConfig);
            const nativeOptions = rustOptions("dc1", policy);

            assert.strictEqual(nativeOptions.localDataCenter, "dc1");
            // The native converter reads the null preference as absent.
            rust.testsCheckClientOption(nativeOptions, 4);
            assert.deepStrictEqual(policyConfig, {
                preferDatacenter: null,
                tokenAware: false,
            });
        });

        it("should pass localDataCenter alongside RoundRobinPolicy", function () {
            const policy = new RoundRobinPolicy();
            const nativeOptions = rustOptions("dc1", policy);

            assert.deepStrictEqual(nativeOptions.loadBalancingConfig, {
                tokenAware: false,
            });
            assert.strictEqual(nativeOptions.localDataCenter, "dc1");
        });

        it("should pass localDataCenter alongside DCAwareRoundRobinPolicy without a preference", function () {
            const policy = new DCAwareRoundRobinPolicy();
            const nativeOptions = rustOptions("dc1", policy);

            assert.deepStrictEqual(nativeOptions.loadBalancingConfig, {
                preferDatacenter: undefined,
                permitDcFailover: false,
                tokenAware: false,
            });
            assert.strictEqual(nativeOptions.localDataCenter, "dc1");
        });

        it("should leave the default policy unchanged without localDataCenter", function () {
            const policyConfig = { tokenAware: false };
            const policy = new DefaultLoadBalancingPolicy(policyConfig);

            const nativeOptions = rustOptions(undefined, policy);

            assert.deepStrictEqual(
                nativeOptions.loadBalancingConfig,
                policyConfig,
            );
            assert.property(nativeOptions, "localDataCenter");
            assert.strictEqual(nativeOptions.localDataCenter, undefined);
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
