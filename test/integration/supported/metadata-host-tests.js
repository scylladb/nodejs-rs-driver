"use strict";
const assert = require("chai").assert;

const helper = require("../../test-helper");
const { Host, HostMap } = require("../../../lib/host");

describe("Client#hosts", function () {
    this.timeout(120000);

    describe("with a single node", function () {
        const setupInfo = helper.setup("1:0");

        describe("when the client is connected", function () {
            it("should return a HostMap with real Host instances", function (done) {
                const hosts = setupInfo.client.hosts;
                assert.instanceOf(hosts, HostMap);
                assert.strictEqual(hosts.length, 1);

                const host = hosts.values()[0];
                assert.instanceOf(host, Host);
                done();
            });

            it("should populate the host address", function (done) {
                const host = setupInfo.client.hosts.values()[0];
                assert.isString(host.address);
                assert.include(host.address, ":");
                done();
            });

            it("should populate the host datacenter and rack", function (done) {
                const host = setupInfo.client.hosts.values()[0];
                assert.strictEqual(host.datacenter, "dc1");
                assert.isString(host.rack);
                done();
            });

            it("should populate the host id as a 16-byte buffer", function (done) {
                const host = setupInfo.client.hosts.values()[0];
                assert.instanceOf(host.hostId, Buffer);
                assert.strictEqual(host.hostId.length, 16);
                done();
            });

            it("should expose the host keyed by its address in the HostMap", function (done) {
                const hosts = setupInfo.client.hosts;
                const host = hosts.values()[0];
                assert.strictEqual(hosts.get(host.address), host);
                assert.deepEqual(hosts.keys(), [host.address]);
                done();
            });

            it("should iterate hosts via forEach() consistently with values()/keys()", function (done) {
                const hosts = setupInfo.client.hosts;
                const seen = [];
                hosts.forEach((host, address) => seen.push([address, host]));

                assert.lengthOf(seen, hosts.length);
                seen.forEach(([address, host]) => {
                    assert.strictEqual(host.address, address);
                });
                done();
            });

            it("should return the same underlying Host instance across repeated Client#hosts accesses", function (done) {
                // Client#hosts builds a fresh HostMap wrapper on every access, but the
                // underlying Host objects are pinned native references that should be reused
                // as long as the cluster snapshot hasn't changed (see
                // src/metadata/host.rs::build_known_nodes / get_all_hosts).
                const hostA = setupInfo.client.hosts.values()[0];
                const hostB = setupInfo.client.hosts.values()[0];
                assert.strictEqual(hostA, hostB);
                done();
            });
        });
    });

    describe("with a multi-datacenter cluster", function () {
        const setupInfo = helper.setup("2:1");

        it("should report the correct total number of hosts", function (done) {
            assert.strictEqual(setupInfo.client.hosts.length, 3);
            done();
        });

        it("should assign hosts to their correct datacenter", function (done) {
            const dc1Host = helper.findHost(setupInfo.client, 1, true);
            const dc2Host = helper.findHost(setupInfo.client, 3, true);

            assert.strictEqual(dc1Host.datacenter, "dc1");
            assert.strictEqual(dc2Host.datacenter, "dc2");
            done();
        });

        it("should give every host in the same datacenter its own rack info", function (done) {
            const hosts = setupInfo.client.hosts.values();
            hosts.forEach((host) => assert.isString(host.rack));
            done();
        });

        it("should give every host a distinct address and hostId", function (done) {
            const hosts = setupInfo.client.hosts.values();
            const addresses = hosts.map((h) => h.address);
            const hostIds = hosts.map((h) => h.hostId.toString("hex"));

            assert.strictEqual(new Set(addresses).size, hosts.length);
            assert.strictEqual(new Set(hostIds).size, hosts.length);
            done();
        });
    });
});
