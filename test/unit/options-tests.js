"use strict";

const rust = require("../../index");
const { setRustOptions } = require("../../lib/client-options");
const {
    DefaultLoadBalancingPolicy,
} = require("../../lib/policies/load-balancing");
const { RetryPolicy } = require("../../lib/policies/retry");

describe("Client options", function () {
    it("should correctly convert client options", function () {
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
            sslOptions: { rejectUnauthorized: false },
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
            },
        };
        rust.testsCheckClientOption(setRustOptions(options), 1);
    });
    it("should correctly convert empty client options", function () {
        let options = {};
        rust.testsCheckClientOption(setRustOptions(options), 2);
    });
});
