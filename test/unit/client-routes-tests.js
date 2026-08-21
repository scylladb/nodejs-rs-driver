"use strict";
const assert = require("assert");
const net = require("node:net");
const rust = require("../../index");
const { setRustOptions } = require("../../lib/client-options");
const {
    MappingAddressTranslator,
} = require("../../lib/policies/address-resolution");

const CONNECTION_ID = "nodejs-driver-client-routes-unit-test";

/** Client options selecting client routes mode, merged with `rest`. */
function withClientRoutes(proxies, rest) {
    return Object.assign({ clientRoutes: { proxies } }, rest);
}

const mode = (options) => rust.testsSessionBuilderMode(setRustOptions(options));
const describeConfig = (options) =>
    rust.testsDescribeClientRoutesConfig(setRustOptions(options));

describe("Client routes options", function () {
    describe("builder selection", function () {
        it("should use the default builder when client routes are not configured", function () {
            assert.strictEqual(
                mode({ contactPoints: ["pl.example:9042"] }),
                "default",
            );
        });

        it("should use the client routes builder when proxies are given", function () {
            assert.strictEqual(
                mode(
                    withClientRoutes([{ connectionId: CONNECTION_ID }], {
                        contactPoints: ["pl.example:9042"],
                    }),
                ),
                "clientRoutes",
            );
        });
    });

    describe("proxy conversion", function () {
        it("should apply hostnameOverride only to the proxy that declares it", function () {
            const described = describeConfig(
                withClientRoutes([
                    { connectionId: "conn-a" },
                    {
                        connectionId: "conn-b",
                        hostnameOverride: "127.0.0.1",
                    },
                ]),
            );

            assert.deepStrictEqual(
                described.match(/overridden_hostname: (None|Some\("[^"]*"\))/g),
                [
                    "overridden_hostname: None",
                    'overridden_hostname: Some("127.0.0.1")',
                ],
            );
        });

        it("should treat an empty hostnameOverride as absent", function () {
            const described = describeConfig(
                withClientRoutes([
                    { connectionId: "conn-a", hostnameOverride: "" },
                ]),
            );

            assert.match(described, /overridden_hostname: None/);
        });

        it("should reject an empty proxy list", function () {
            assert.throws(
                () => describeConfig({ clientRoutes: { proxies: [] } }),
                /Invalid clientRoutes configuration/,
            );
        });

        it("should reject a proxy without a connectionId, naming its index", function () {
            assert.throws(
                () =>
                    describeConfig({
                        clientRoutes: {
                            proxies: [
                                { connectionId: "conn-a" },
                                { hostnameOverride: "127.0.0.1" },
                            ],
                        },
                    }),
                /proxy at index 1 must have a non-empty connectionId/,
            );
        });
    });

    describe("rejected configurations", function () {
        it("should reject client routes combined with sslOptions", function () {
            assert.throws(
                () =>
                    mode(
                        withClientRoutes([{ connectionId: CONNECTION_ID }], {
                            contactPoints: ["pl.example:9042"],
                            sslOptions: { rejectUnauthorized: false },
                        }),
                    ),
                /cannot be combined with sslOptions/,
            );
        });

        it("should reject client routes combined with an address translator", function () {
            const mapping = new Map([
                [
                    new net.SocketAddress({ address: "2.1.3.7", port: 690 }),
                    new net.SocketAddress({ address: "7.3.1.2", port: 960 }),
                ],
            ]);

            assert.throws(
                () =>
                    mode(
                        withClientRoutes([{ connectionId: CONNECTION_ID }], {
                            contactPoints: ["pl.example:9042"],
                            policies: {
                                addressResolution: new MappingAddressTranslator(
                                    mapping,
                                ),
                            },
                        }),
                    ),
                /cannot be combined with an address resolution policy/,
            );
        });
    });
});
