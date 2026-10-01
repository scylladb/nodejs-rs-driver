"use strict";

const { assert } = require("chai");

const clientOptions = require("../../lib/client-options");
const { protocolVersion } = require("../../lib/types");

describe("protocolVersion", function () {
    describe("#isSupported()", function () {
        it("should only support native protocol v4", function () {
            assert.isTrue(protocolVersion.isSupported(protocolVersion.v4));

            [
                protocolVersion.v1,
                protocolVersion.v2,
                protocolVersion.v3,
                protocolVersion.v5,
                protocolVersion.v6,
                protocolVersion.dseV1,
                protocolVersion.dseV2,
            ].forEach(function (version) {
                assert.isFalse(protocolVersion.isSupported(version));
            });
        });
    });

    describe("protocolOptions.maxVersion", function () {
        it("should accept native protocol v4", function () {
            assert.doesNotThrow(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    protocolOptions: { maxVersion: protocolVersion.v4 },
                });
            });
        });

        it("should reject lower native protocol versions", function () {
            [
                protocolVersion.v1,
                protocolVersion.v2,
                protocolVersion.v3,
            ].forEach(function (version) {
                assert.throws(function () {
                    clientOptions.extend({
                        contactPoints: ["host1"],
                        protocolOptions: { maxVersion: version },
                    });
                }, TypeError);
            });
        });
    });
});
