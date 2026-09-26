"use strict";

const { assert } = require("chai");
const { getClientArgs } = require("../../examples/util");

describe("examples client options", function () {
    const originalScyllaUri = process.env.SCYLLA_URI;
    const originalDatacenter = process.env.DATACENTER;

    afterEach(function () {
        restoreEnvironmentVariable("SCYLLA_URI", originalScyllaUri);
        restoreEnvironmentVariable("DATACENTER", originalDatacenter);
    });

    it("should prefer datacenter1 with the default contact point", function () {
        delete process.env.SCYLLA_URI;
        delete process.env.DATACENTER;

        assert.deepStrictEqual(getClientArgs(), {
            contactPoints: ["172.17.0.2:9042"],
            localDataCenter: "datacenter1",
        });
    });

    it("should not assume a datacenter for custom contact points", function () {
        process.env.SCYLLA_URI = "db.example.com:9042";
        delete process.env.DATACENTER;

        assert.deepStrictEqual(getClientArgs(), {
            contactPoints: ["db.example.com:9042"],
            localDataCenter: undefined,
        });
    });

    it("should use the configured datacenter with custom contact points", function () {
        process.env.SCYLLA_URI = "db.example.com:9042";
        process.env.DATACENTER = "analytics";

        assert.deepStrictEqual(getClientArgs(), {
            contactPoints: ["db.example.com:9042"],
            localDataCenter: "analytics",
        });
    });
});

function restoreEnvironmentVariable(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}
