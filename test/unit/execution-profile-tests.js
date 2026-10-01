"use strict";

const assert = require("assert");

const clientOptions = require("../../lib/client-options");
const ExecutionProfile =
    require("../../lib/execution-profile").ExecutionProfile;
const ProfileManager = require("../../lib/execution-profile").ProfileManager;
const types = require("../../lib/types");

describe("ExecutionProfile", function () {
    it("should accept a zero read timeout", function () {
        const profile = new ExecutionProfile("no-timeout", { readTimeout: 0 });
        assert.strictEqual(profile.readTimeout, 0);
    });

    it("should reject invalid read timeouts", function () {
        [-1, 1.5, NaN, Infinity, 0x80000000, "100"].forEach((readTimeout) => {
            assert.throws(
                () => new ExecutionProfile("invalid", { readTimeout }),
                /ExecutionProfile\.readTimeout must be an integer between 0 and 2147483647/,
            );
        });
    });
});

describe("ProfileManager", function () {
    describe("constructor", function () {
        it("should set the default profile based on the client options", function () {
            const options = clientOptions.defaultOptions();
            const manager = new ProfileManager(options);
            const profile = manager.getDefault();
            assert.ok(profile);
            assert.strictEqual(
                profile.loadBalancing,
                options.policies.loadBalancing,
            );
            assert.strictEqual(profile.retry, options.policies.retry);
        });
        it("should set the default profile required options", function () {
            const options = clientOptions.defaultOptions();
            options.profiles = [new ExecutionProfile("default")];
            const manager = new ProfileManager(options);
            const profile = manager.getDefault();
            assert.ok(profile);
            assert.strictEqual(profile, options.profiles[0]);
            assert.strictEqual(
                profile.loadBalancing,
                options.policies.loadBalancing,
            );
            assert.strictEqual(profile.retry, options.policies.retry);
        });
    });
    describe("#getProfile()", function () {
        it("should get the profile by name", function () {
            const options = clientOptions.defaultOptions();
            options.profiles = [
                new ExecutionProfile("metrics", {
                    consistency: types.consistencies.localQuorum,
                }),
            ];
            const manager = new ProfileManager(options);
            const profile = manager.getProfile("metrics");
            assert.ok(profile);
            assert.strictEqual(profile, options.profiles[0]);
            assert.strictEqual(
                profile.consistency,
                types.consistencies.localQuorum,
            );
            assert.ok(manager.getDefault());
            assert.notStrictEqual(manager.getDefault(), profile);
            assert.strictEqual(manager.getProfile("metrics"), profile);
        });
        it("should get the default profile when name is undefined", function () {
            const options = clientOptions.defaultOptions();
            const manager = new ProfileManager(options);
            const profile = manager.getProfile(undefined);
            assert.ok(profile);
            assert.strictEqual(manager.getDefault(), profile);
        });
        it("should return same the execution profile if provided", function () {
            const options = clientOptions.defaultOptions();
            const manager = new ProfileManager(options);
            const metricsProfile = new ExecutionProfile("metrics");
            options.profiles = [metricsProfile];
            const profile = manager.getProfile(metricsProfile);
            assert.ok(profile);
            assert.strictEqual(profile, metricsProfile);
        });
    });
});
