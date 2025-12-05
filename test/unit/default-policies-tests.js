"use strict";

const { assert } = require("chai");

const {
    NewDefaultLoadBalancingPolicy,
    LoadBalancingConfig,
} = require("../../lib/policies/load-balancing");
const { policies } = require("../../main");

describe("policies.defaultLoadBalancingPolicy()", () => {
    it(`should support creating a new instance`, () => {
        const lbp = policies.defaultLoadBalancingPolicy();
        assert.instanceOf(lbp, NewDefaultLoadBalancingPolicy);
        assert.instanceOf(lbp.getRustConfiguration(), LoadBalancingConfig);
    });
});
