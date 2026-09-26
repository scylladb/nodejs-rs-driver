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
        assert.deepEqual(lbp.getRustConfiguration(), new LoadBalancingConfig());
    });

    it("should prefer the provided data center with failover disabled", () => {
        const lbp = policies.defaultLoadBalancingPolicy("dc1");
        assert.instanceOf(lbp, DefaultLoadBalancingPolicy);
        assert.deepEqual(lbp.getRustConfiguration(), {
            preferDatacenter: "dc1",
            permitDcFailover: false,
        });
    });
});
