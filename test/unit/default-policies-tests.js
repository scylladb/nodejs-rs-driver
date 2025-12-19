"use strict";

const { assert } = require("chai");

const {
    DefaultLoadBalancingPolicy,
    LoadBalancingConfig,
} = require("../../lib/policies/load-balancing");
const { policies } = require("../../main");

describe("policies.defaultLoadBalancingPolicy()", () => {
    it(`should support creating a new instance`, () => {
        const lbp = policies.defaultLoadBalancingPolicy();
        assert.instanceOf(lbp, DefaultLoadBalancingPolicy);
        assert.instanceOf(lbp.getRustConfiguration(), LoadBalancingConfig);
    });
});
