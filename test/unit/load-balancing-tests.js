"use strict";
const assert = require("assert");

const helper = require("../test-helper.js");
const {
    AllowListPolicy,
    TokenAwarePolicy,
    RoundRobinPolicy,
    DCAwareRoundRobinPolicy,
} = require("../../lib/policies/load-balancing");

describe("RoundRobinPolicy", function () {
    describe("#getOptions()", () => {
        it("should return an empty Map", () =>
            helper.assertMapEqual(
                new RoundRobinPolicy().getOptions(),
                new Map(),
            ));
    });
    it("should get proper config from getRustConfiguration()", () => {
        const policy = new RoundRobinPolicy();
        const config = policy.getRustConfiguration();
        assert.deepEqual(config, { tokenAware: false });
    });
});
describe("DCAwareRoundRobinPolicy", function () {
    describe("#getOptions()", () => {
        it("should return a Map with the local data center name", () => {
            helper.assertMapEqual(
                new DCAwareRoundRobinPolicy("local1").getOptions(),
                new Map([["localDataCenter", "local1"]]),
            );
        });
    });
    it("should get proper config from getRustConfiguration()", () => {
        const policy = new DCAwareRoundRobinPolicy("dc1");
        const config = policy.getRustConfiguration();
        assert.deepEqual(config, {
            preferDatacenter: "dc1",
            permitDcFailover: false,
            tokenAware: false,
        });
    });
});
describe("TokenAwarePolicy", function () {
    describe("#getOptions()", () => {
        it("should return a Map with the child policy name", () => {
            helper.assertMapEqual(
                new TokenAwarePolicy(new RoundRobinPolicy()).getOptions(),
                new Map([["childPolicy", "RoundRobinPolicy"]]),
            );
        });
    });
    it("should get proper config from getRustConfiguration()", () => {
        const childPolicy = new DCAwareRoundRobinPolicy("dc1");
        const policy = new TokenAwarePolicy(childPolicy);
        const config = policy.getRustConfiguration();
        assert.deepEqual(config, {
            preferDatacenter: "dc1",
            permitDcFailover: false,
            tokenAware: true,
        });
    });
});
describe("AllowListPolicy", function () {
    describe("#getOptions()", () => {
        it("should return a Map with the child policy name", () => {
            helper.assertMapEqual(
                new AllowListPolicy(new RoundRobinPolicy(), [
                    "a",
                    "b",
                ]).getOptions(),
                new Map([
                    ["childPolicy", "RoundRobinPolicy"],
                    ["allowList", ["a", "b"]],
                ]),
            );
        });
    });
    it("should get proper config from getRustConfiguration()", () => {
        const childPolicy = new RoundRobinPolicy();
        const allowList = ["127.0.0.1:9042", "127.0.0.2:9042"];
        const policy = new AllowListPolicy(childPolicy, allowList);
        const config = policy.getRustConfiguration();
        assert.deepEqual(config, {
            tokenAware: false,
            allowList: allowList,
        });
    });
});
