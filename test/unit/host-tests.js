"use strict";
const { assert } = require("chai");
const events = require("events");
const { Host, HostMap } = require("../../lib/host");

/**
 * Builds a real `Host` instance the same way the native driver would (constructor is only
 * meant to be invoked by Rust in production, but nothing prevents constructing one directly
 * in a unit test with synthetic data).
 */
function makeHost(address, datacenter, rack, hostIdByte) {
    const hostId = Buffer.alloc(16, hostIdByte);
    return new Host(address, datacenter, rack, hostId);
}

describe("Host", function () {
    describe("constructor", function () {
        it("should be an EventEmitter", function () {
            const host = makeHost("127.0.0.1:9042", "dc1", "rack1", 1);
            assert.instanceOf(host, events.EventEmitter);
        });

        it("should populate address, datacenter, rack and hostId as given", function () {
            const host = makeHost("127.0.0.1:9042", "dc1", "rack1", 7);

            assert.strictEqual(host.address, "127.0.0.1:9042");
            assert.strictEqual(host.datacenter, "dc1");
            assert.strictEqual(host.rack, "rack1");
            assert.instanceOf(host.hostId, Buffer);
            assert.lengthOf(host.hostId, 16);
            assert.isTrue(host.hostId.equals(Buffer.alloc(16, 7)));
        });

        it("should allow null datacenter and rack", function () {
            const host = makeHost("127.0.0.1:9042", null, null, 0);

            assert.isNull(host.datacenter);
            assert.isNull(host.rack);
        });

        it("should always initialize cassandraVersion and tokens to null", function () {
            // The native driver never populates these fields today; this test documents and
            // guards that known, current behavior.
            const host = makeHost("127.0.0.1:9042", "dc1", "rack1", 1);

            assert.isNull(host.cassandraVersion);
            assert.isNull(host.tokens);
        });
    });

    describe("unimplemented/unsupported members", function () {
        let host;

        beforeEach(function () {
            host = makeHost("127.0.0.1:9042", "dc1", "rack1", 1);
        });

        it("should throw ReferenceError when getting dseVersion", function () {
            assert.throws(() => host.dseVersion, ReferenceError, /dseVersion/);
        });

        it("should throw ReferenceError when setting dseVersion", function () {
            assert.throws(
                () => {
                    host.dseVersion = "1.0";
                },
                ReferenceError,
                /dseVersion/,
            );
        });

        it("should throw ReferenceError when getting workloads", function () {
            assert.throws(() => host.workloads, ReferenceError, /workloads/);
        });

        it("should throw ReferenceError when setting workloads", function () {
            assert.throws(
                () => {
                    host.workloads = [];
                },
                ReferenceError,
                /workloads/,
            );
        });

        it("should throw when calling isUp()", function () {
            assert.throws(() => host.isUp(), /Not implemented/);
        });

        it("should throw when calling canBeConsideredAsUp()", function () {
            assert.throws(() => host.canBeConsideredAsUp(), /Not implemented/);
        });

        it("should throw when calling getCassandraVersion()", function () {
            assert.throws(() => host.getCassandraVersion(), /Not implemented/);
        });

        it("should throw ReferenceError when calling getDseVersion()", function () {
            assert.throws(
                () => host.getDseVersion(),
                ReferenceError,
                /getDseVersion/,
            );
        });
    });
});

describe("HostMap", function () {
    describe("fromRust()", function () {
        it("should build an empty HostMap from an empty array", function () {
            const hostMap = HostMap.fromRust([]);

            assert.instanceOf(hostMap, HostMap);
            assert.strictEqual(hostMap.length, 0);
            assert.deepEqual(hostMap.keys(), []);
            assert.deepEqual(hostMap.values(), []);
        });

        it("should build a HostMap keyed by host address", function () {
            const host1 = makeHost("127.0.0.1:9042", "dc1", "rack1", 1);
            const host2 = makeHost("127.0.0.2:9042", "dc1", "rack2", 2);
            const hostMap = HostMap.fromRust([host1, host2]);

            assert.strictEqual(hostMap.length, 2);
            assert.sameMembers(hostMap.keys(), [
                "127.0.0.1:9042",
                "127.0.0.2:9042",
            ]);
            assert.sameMembers(hostMap.values(), [host1, host2]);
        });

        it("should let the last host win when addresses collide", function () {
            const host1 = makeHost("127.0.0.1:9042", "dc1", "rack1", 1);
            const host2 = makeHost("127.0.0.1:9042", "dc1", "rack1", 2);
            const hostMap = HostMap.fromRust([host1, host2]);

            assert.strictEqual(hostMap.length, 1);
            assert.strictEqual(hostMap.get("127.0.0.1:9042"), host2);
        });
    });

    describe("instance behavior", function () {
        let host1;
        let host2;
        let hostMap;

        beforeEach(function () {
            host1 = makeHost("127.0.0.1:9042", "dc1", "rack1", 1);
            host2 = makeHost("127.0.0.2:9042", "dc1", "rack2", 2);
            hostMap = HostMap.fromRust([host1, host2]);
        });

        it("should be an EventEmitter", function () {
            assert.instanceOf(hostMap, events.EventEmitter);
        });

        it("get() should return the host for a known address, undefined otherwise", function () {
            assert.strictEqual(hostMap.get("127.0.0.1:9042"), host1);
            assert.isUndefined(hostMap.get("10.0.0.1:9042"));
        });

        it("forEach() should invoke the callback once per host with (value, key)", function () {
            const seen = [];
            hostMap.forEach((value, key) => seen.push([key, value]));

            assert.lengthOf(seen, 2);
            assert.sameDeepMembers(seen, [
                ["127.0.0.1:9042", host1],
                ["127.0.0.2:9042", host2],
            ]);
        });

        it("values() should return a frozen, cached array", function () {
            const values1 = hostMap.values();
            const values2 = hostMap.values();

            assert.isFrozen(values1);
            // Same underlying array instance is returned on every call (memoized).
            assert.strictEqual(values1, values2);
            assert.sameMembers(values1, [host1, host2]);
        });

        it("toJSON() should return a plain object keyed by address", function () {
            const json = hostMap.toJSON();

            assert.deepEqual(json, {
                "127.0.0.1:9042": host1,
                "127.0.0.2:9042": host2,
            });
        });

        it("inspect() should return the internal Map", function () {
            const inspected = hostMap.inspect();

            assert.instanceOf(inspected, Map);
            assert.strictEqual(inspected.get("127.0.0.1:9042"), host1);
        });

        it("length getter should reflect the number of hosts", function () {
            assert.strictEqual(hostMap.length, 2);
        });

        ["remove", "removeMultiple", "set", "clear"].forEach((method) => {
            it(`${method}() should throw ReferenceError (not supported)`, function () {
                assert.throws(
                    () => hostMap[method](),
                    ReferenceError,
                    new RegExp(`HostMap\\.${method}`),
                );
            });
        });
    });
});
