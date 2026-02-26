"use strict";
const { assert } = require("chai");
const util = require("util");

const Client = require("../../lib/client");
const clientOptions = require("../../lib/client-options");
const auth = require("../../lib/auth");
const types = require("../../lib/types");
const loadBalancing = require("../../lib/policies/load-balancing");
const retry = require("../../lib/policies/retry");
const speculativeExecution = require("../../lib/policies/speculative-execution");
const timestampGeneration = require("../../lib/policies/timestamp-generation");
const utils = require("../../lib/utils");
const helper = require("../test-helper");

const contactPoints = ["a"];

describe("types", function () {
    describe("Long", function () {
        const Long = types.Long;
        it("should convert from and to Buffer", function () {
            [
                // int64 decimal value    //hex value
                ["-123456789012345678", "fe4964b459cf0cb2"],
                ["-800000000000000000", "f4e5d43d13b00000"],
                ["-888888888888888888", "f3aa0843dcfc71c8"],
                ["-555555555555555555", "f84a452a6a1dc71d"],
                ["-789456", "fffffffffff3f430"],
                ["-911111111111111144", "f35b15458f4f8e18"],
                ["-9007199254740993", "ffdfffffffffffff"],
                ["-1125899906842624", "fffc000000000000"],
                ["555555555555555555", "07b5bad595e238e3"],
                ["789456", "00000000000c0bd0"],
                ["888888888888888888", "0c55f7bc23038e38"],
            ].forEach(function (item) {
                const buffer = utils.allocBufferFromString(item[1], "hex");
                const value = Long.fromBuffer(buffer);
                assert.strictEqual(value.toString(), item[0]);
                assert.strictEqual(
                    Long.toBuffer(value).toString("hex"),
                    buffer.toString("hex"),
                    "Hexadecimal values should match for " + item[1],
                );
            });
        });

        it("should return a valid number for int greater than 2^53 and less than -2^53", function () {
            [
                new Long(0, 0x7fffffff),
                new Long(0xffffffff, 0x7fffffff),
                new Long(0xffffffff, 0x7fffff01),
            ].forEach(function (item) {
                assert.ok(
                    item.toNumber() > Math.pow(2, 53),
                    util.format(
                        "Value should be greater than 2^53 for %s",
                        item,
                    ),
                );
            });
            [new Long(0, 0xf0000000), new Long(0, 0xf0000001)].forEach(
                function (item) {
                    assert.ok(
                        item.toNumber() < Math.pow(2, 53),
                        util.format(
                            "Value should be less than -2^53 for %s",
                            item,
                        ),
                    );
                },
            );
        });
    });
    describe("Integer", function () {
        const Integer = types.Integer;

        const values = [
            // hex value                      |      string varint
            ["02000001", "33554433"],
            ["02000000", "33554432"],
            ["1111111111111111", "1229782938247303441"],
            ["01", "1"],
            ["0400", "1024"],
            ["7fffffff", "2147483647"],
            ["02000000000001", "562949953421313"],
            ["ff", "-1"],
            ["ff01", "-255"],
            ["faa8c4", "-350012"],
            ["eb233d9f", "-350012001"],
            ["f7d9c411c4", "-35001200188"],
            ["f0bdc0", "-1000000"],
            ["ff172b5aeff4", "-1000000000012"],
            ["9c", "-100"],
            ["c31e", "-15586"],
            ["00c31e", "49950"],
            ["0500e3c2cef9eaaab3", "92297829382473034419"],
            ["033171cbe0fac2d665b78d4e", "988229782938247303441911118"],
            ["fcce8e341f053d299a4872b2", "-988229782938247303441911118"],
            [
                "00b70cefb9c19c9c5112972fd01a4e676d",
                "243315893003967298069149506221212854125",
            ],
            ["00ba0cef", "12193007"],
            ["00ffffffff", "4294967295"],
        ];

        it("should create from buffer", function () {
            values.forEach(function (item) {
                const buffer = utils.allocBufferFromString(item[0], "hex");
                const value = Integer.fromBuffer(buffer);
                assert.strictEqual(value.toString(), item[1]);
            });
        });
        it("should convert to buffer", function () {
            values.forEach(function (item) {
                const buffer = Integer.toBuffer(Integer.fromString(item[1]));
                assert.strictEqual(buffer.toString("hex"), item[0]);
            });
        });
    });
    describe("ResultStream", function () {
        it("should be readable as soon as it has data", function (done) {
            const buf = [];
            const stream = new types.ResultStream();

            stream.on("end", function streamEnd() {
                assert.strictEqual(
                    Buffer.concat(buf).toString(),
                    "Jimmy McNulty",
                );
                done();
            });
            stream.on("readable", function streamReadable() {
                let item;
                while ((item = stream.read())) {
                    buf.push(item);
                }
            });
            stream.add(utils.allocBufferFromString("Jimmy"));
            stream.add(utils.allocBufferFromString(" "));
            stream.add(utils.allocBufferFromString("McNulty"));
            stream.add(null);
        });

        it("should buffer until is read", function (done) {
            const buf = [];
            const stream = new types.ResultStream();
            stream.add(utils.allocBufferFromString("Stringer"));
            stream.add(utils.allocBufferFromString(" "));
            stream.add(utils.allocBufferFromString("Bell"));
            stream.add(null);

            stream.on("end", function streamEnd() {
                assert.equal(Buffer.concat(buf).toString(), "Stringer Bell");
                done();
            });
            stream.on("readable", function streamReadable() {
                let item;
                while ((item = stream.read())) {
                    buf.push(item);
                }
            });
        });

        it("should be readable until the end", function (done) {
            const buf = [];
            const stream = new types.ResultStream();
            stream.add(utils.allocBufferFromString("Omar"));
            stream.add(utils.allocBufferFromString(" "));

            stream.on("end", function streamEnd() {
                assert.equal(Buffer.concat(buf).toString(), "Omar Little");
                done();
            });
            stream.on("readable", function streamReadable() {
                let item;
                while ((item = stream.read())) {
                    buf.push(item);
                }
            });

            stream.add(utils.allocBufferFromString("Little"));
            stream.add(null);
        });

        it("should be readable on objectMode", function (done) {
            const buf = [];
            const stream = new types.ResultStream({ objectMode: true });
            // passing objects
            stream.add({
                toString: function () {
                    return "One";
                },
            });
            stream.add({
                toString: function () {
                    return "Two";
                },
            });
            stream.add(null);
            stream.on("end", function streamEnd() {
                assert.equal(buf.join(" "), "One Two");
                done();
            });
            stream.on("readable", function streamReadable() {
                let item;
                while ((item = stream.read())) {
                    buf.push(item);
                }
            });
        });
    });
    describe("generateTimestamp()", function () {
        it("should generate using date and microseconds parts", function () {
            let date = new Date();
            let value = types.generateTimestamp(date, 123);
            assert.instanceOf(value, types.Long);
            assert.strictEqual(
                value.toString(),
                types.Long.fromNumber(date.getTime())
                    .multiply(types.Long.fromInt(1000))
                    .add(types.Long.fromInt(123))
                    .toString(),
            );

            date = new Date("2010-04-29");
            value = types.generateTimestamp(date, 898);
            assert.instanceOf(value, types.Long);
            assert.strictEqual(
                value.toString(),
                types.Long.fromNumber(date.getTime())
                    .multiply(types.Long.fromInt(1000))
                    .add(types.Long.fromInt(898))
                    .toString(),
            );
        });
    });
});
describe("utils", function () {
    describe("#extend()", function () {
        it("should allow null sources", function () {
            const originalObject = {};
            const extended = utils.extend(originalObject, null);
            assert.strictEqual(originalObject, extended);
        });
    });
    describe("#funcCompare()", function () {
        it("should return a compare function valid for Array#sort", function () {
            const values = [
                { id: 1, getValue: () => 100 },
                { id: 2, getValue: () => 3 },
                { id: 3, getValue: () => 1 },
            ];
            values.sort(utils.funcCompare("getValue"));
            assert.strictEqual(values[0].id, 3);
            assert.strictEqual(values[1].id, 2);
            assert.strictEqual(values[2].id, 1);
        });
    });
    describe("#binarySearch()", function () {
        it("should return the key index if found, or the bitwise compliment of the first larger value", function () {
            const compareFunc = function (a, b) {
                if (a > b) {
                    return 1;
                }
                if (a < b) {
                    return -1;
                }
                return 0;
            };
            let val;
            val = utils.binarySearch([0, 1, 2, 3, 4], 2, compareFunc);
            assert.strictEqual(val, 2);
            val = utils.binarySearch(
                ["A", "B", "C", "D", "E"],
                "D",
                compareFunc,
            );
            assert.strictEqual(val, 3);
            val = utils.binarySearch(
                ["A", "B", "C", "D", "Z"],
                "M",
                compareFunc,
            );
            assert.strictEqual(val, ~4);
            val = utils.binarySearch([0, 1, 2, 3, 4], 2.5, compareFunc);
            assert.strictEqual(val, ~3);
        });
    });
    describe("#deepExtend", function () {
        it("should override only the most inner props", function () {
            let value;
            // single values
            value = utils.deepExtend({}, { a: "1" });
            assert.strictEqual(value.a, "1");
            value = utils.deepExtend({ a: "2" }, { a: "1" });
            assert.strictEqual(value.a, "1");
            value = utils.deepExtend({ a: new Date() }, { a: new Date(100) });
            assert.strictEqual(value.a.toString(), new Date(100).toString());
            value = utils.deepExtend({ a: 2 }, { a: 1 });
            assert.strictEqual(value.a, 1);
            // composed 1 level
            value = utils.deepExtend(
                { a: { a1: 1, a2: 2 }, b: 1000 },
                { a: { a2: 15 } },
            );
            assert.strictEqual(value.a.a2, 15);
            assert.strictEqual(value.a.a1, 1);
            assert.strictEqual(value.b, 1000);
            // composed 2 level
            value = utils.deepExtend(
                { a: { a1: 1, a2: { a21: 10, a22: 20 } } },
                { a: { a2: { a21: 11 } }, b: { b1: 100, b2: 200 } },
            );
            assert.strictEqual(value.a.a2.a21, 11);
            assert.strictEqual(value.a.a2.a22, 20);
            assert.strictEqual(value.a.a1, 1);
            assert.strictEqual(value.b.b1, 100);
            assert.strictEqual(value.b.b2, 200);
            // multiple sources
            value = utils.deepExtend(
                { z: 9 },
                { a: { a1: 1, a2: { a21: 10, a22: 20 } } },
                { a: { a2: { a21: 11 } }, b: { b1: 100, b2: 200 } },
            );
            assert.strictEqual(value.a.a2.a21, 11);
            assert.strictEqual(value.a.a2.a22, 20);
            assert.strictEqual(value.a.a1, 1);
            assert.strictEqual(value.b.b1, 100);
            assert.strictEqual(value.b.b2, 200);
            assert.strictEqual(value.z, 9);
            // !source
            value = utils.deepExtend({ z: 3 }, null);
            assert.strictEqual(value.z, 3);
            // undefined
            const o = undefined;
            value = utils.deepExtend({ z: 4 }, o);
            assert.strictEqual(value.z, 4);
        });
    });
});
describe("clientOptions", function () {
    describe("#extend()", function () {
        it("should require contactPoints", function () {
            assert.doesNotThrow(function () {
                clientOptions.extend({ contactPoints: ["host1", "host2"] });
            });
            assert.throws(function () {
                clientOptions.extend({ contactPoints: {} });
            });
            assert.throws(function () {
                clientOptions.extend({});
            });
            assert.throws(function () {
                clientOptions.extend(null);
            });
            assert.throws(function () {
                clientOptions.extend(undefined);
            });
        });
        it("should create a new instance", function () {
            const a = { contactPoints: ["host1"] };
            let options = clientOptions.extend(a);
            assert.notStrictEqual(a, options);
            assert.notStrictEqual(options, clientOptions.defaultOptions());
            // it should use baseOptions as source
            const b = {};
            options = clientOptions.extend(b, a);
            // B is the instance source
            assert.strictEqual(b, options);
            // A is the target
            assert.notStrictEqual(a, options);
            assert.notStrictEqual(options, clientOptions.defaultOptions());
        });
        it("should validate the policies", function () {
            const policy1 = new loadBalancing.RoundRobinPolicy();
            const policy2 = new retry.RetryPolicy();
            const options = clientOptions.extend({
                contactPoints: ["host1"],
                policies: {
                    loadBalancing: policy1,
                    retry: policy2,
                },
            });
            assert.strictEqual(options.policies.loadBalancing, policy1);
            assert.strictEqual(options.policies.retry, policy2);

            assert.throws(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    policies: {
                        loadBalancing: {},
                    },
                });
            });
            assert.throws(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    policies: {
                        // Use whatever object
                        loadBalancing: new (function C1() {})(),
                    },
                });
            });
            assert.throws(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    policies: {
                        // Use whatever object
                        retry: new (function C2() {})(),
                    },
                });
            });
        });
        it("should validate the encoding options", function () {
            function DummyConstructor() {}
            assert.doesNotThrow(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    encoding: {},
                });
            });
            assert.doesNotThrow(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    encoding: { map: helper.Map },
                });
            });
            assert.throws(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    encoding: { map: 1 },
                });
            });
            assert.throws(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    encoding: { map: DummyConstructor },
                });
            });
        });
        it("should validate protocolOptions.maxVersion", function () {
            assert.throws(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    protocolOptions: { maxVersion: "1" },
                });
            }, TypeError);
            assert.throws(function () {
                clientOptions.extend({
                    contactPoints: ["host1"],
                    protocolOptions: { maxVersion: 16 },
                });
            }, TypeError);
        });
        it("should validate credentials", () => {
            const message =
                /credentials username and password must be a string/;

            assert.throws(
                () => clientOptions.extend({ contactPoints, credentials: {} }),
                message,
            );

            assert.throws(
                () =>
                    clientOptions.extend({
                        contactPoints,
                        credentials: { username: "a" },
                    }),
                message,
            );

            assert.throws(
                () =>
                    clientOptions.extend({
                        contactPoints,
                        credentials: { password: "b" },
                    }),
                message,
            );

            assert.doesNotThrow(() =>
                clientOptions.extend({
                    contactPoints,
                    credentials: { username: "a", password: "b" },
                }),
            );
        });
        it("should validate authProvider", () => {
            const message =
                /options\.authProvider must be an instance of AuthProvider/;

            assert.throws(
                () => clientOptions.extend({ contactPoints, authProvider: {} }),
                message,
            );

            assert.throws(
                () =>
                    clientOptions.extend({ contactPoints, authProvider: true }),
                message,
            );

            assert.throws(
                () =>
                    clientOptions.extend({
                        contactPoints,
                        authProvider: "abc",
                    }),
                message,
            );

            assert.doesNotThrow(() =>
                clientOptions.extend({
                    contactPoints,
                    authProvider: new auth.PlainTextAuthProvider("a", "b"),
                }),
            );

            assert.doesNotThrow(() =>
                clientOptions.extend({ contactPoints, authProvider: null }),
            );

            assert.doesNotThrow(() =>
                clientOptions.extend({
                    contactPoints,
                    authProvider: undefined,
                }),
            );
        });
        it("should use the authProvider when both credentials and authProvider are defined", () => {
            const authProvider = new auth.PlainTextAuthProvider("a", "b");

            const options = clientOptions.extend({
                contactPoints,
                authProvider,
                credentials: { username: "c", password: "d" },
            });

            assert.strictEqual(options.authProvider, authProvider);
        });
    });
    describe("#defaultOptions()", function () {
        const options = clientOptions.defaultOptions();
        it("should set not set the default consistency level", function () {
            assert.strictEqual(options.queryOptions.consistency, undefined);
        });
        it("should set True to warmup option", function () {
            assert.strictEqual(options.pooling.warmup, true);
        });
        it("should set 12secs as default read timeout", function () {
            assert.strictEqual(12000, options.socketOptions.readTimeout);
        });
        it("should set useUndefinedAsUnset as true", function () {
            assert.strictEqual(true, options.encoding.useUndefinedAsUnset);
        });
    });
});

describe("exports", function () {
    it("should contain API", function () {
        // test that the exposed API is the one expected
        // it looks like a dumb test and it is, but it is necessary!

        const api = require("../../main.js");
        assert.strictEqual(api.Client, Client);
        assert.ok(api.errors);
        assert.strictEqual(typeof api.errors.DriverError, "function");
        assert.strictEqual(typeof api.ExecutionProfile, "function");
        assert.strictEqual(api.ExecutionProfile.name, "ExecutionProfile");
        assert.strictEqual(typeof api.ExecutionOptions, "function");
        assert.strictEqual(api.ExecutionOptions.name, "ExecutionOptions");
        assert.ok(api.types);
        assert.ok(api.policies);
        assert.ok(api.auth);
        assert.ok(typeof api.auth.AuthProvider, "function");
        // policies modules
        assert.strictEqual(api.policies.loadBalancing, loadBalancing);
        assert.strictEqual(
            typeof api.policies.loadBalancing.LoadBalancingPolicy,
            "function",
        );
        assert.instanceOf(
            api.policies.defaultLoadBalancingPolicy(),
            api.policies.loadBalancing.LoadBalancingPolicy,
        );
        assert.strictEqual(api.policies.retry, retry);
        assert.strictEqual(typeof api.policies.retry.RetryPolicy, "function");
        assert.instanceOf(
            api.policies.defaultRetryPolicy(),
            api.policies.retry.RetryPolicy,
        );
        assert.strictEqual(
            api.policies.reconnection,
            require("../../lib/policies/reconnection"),
        );
        assert.strictEqual(
            typeof api.policies.reconnection.ReconnectionPolicy,
            "function",
        );
        assert.instanceOf(
            api.policies.defaultReconnectionPolicy(),
            api.policies.reconnection.ReconnectionPolicy,
        );
        assert.strictEqual(
            api.policies.speculativeExecution,
            speculativeExecution,
        );
        assert.strictEqual(
            typeof speculativeExecution.NoSpeculativeExecutionPolicy,
            "function",
        );
        assert.strictEqual(
            typeof speculativeExecution.ConstantSpeculativeExecutionPolicy,
            "function",
        );
        assert.strictEqual(
            typeof speculativeExecution.SpeculativeExecutionPolicy,
            "function",
        );
        assert.strictEqual(
            api.policies.timestampGeneration,
            timestampGeneration,
        );
        assert.strictEqual(
            typeof timestampGeneration.TimestampGenerator,
            "function",
        );
        assert.strictEqual(
            typeof timestampGeneration.MonotonicTimestampGenerator,
            "function",
        );
        assert.instanceOf(
            api.policies.defaultTimestampGenerator(),
            timestampGeneration.MonotonicTimestampGenerator,
        );
        assert.strictEqual(api.auth, require("../../lib/auth"));

        // mapping module
        assert.ok(api.mapping);
        assertConstructorExposed(api.mapping, api.mapping.TableMappings);
        assertConstructorExposed(api.mapping, api.mapping.DefaultTableMappings);
        assertConstructorExposed(
            api.mapping,
            api.mapping.UnderscoreCqlToCamelCaseMappings,
        );
        assertConstructorExposed(api.mapping, api.mapping.Mapper);
        assertConstructorExposed(api.mapping, api.mapping.ModelMapper);
        assertConstructorExposed(api.mapping, api.mapping.ModelBatchItem);
        assertConstructorExposed(api.mapping, api.mapping.ModelBatchMapper);
        assertConstructorExposed(api.mapping, api.mapping.Result);
        assert.ok(api.mapping.q);
        assert.strictEqual(typeof api.mapping.q.in_, "function");

        // metadata module with classes
        assert.ok(api.metadata);
        assert.strictEqual(typeof api.metadata.Metadata, "function");
        assert.strictEqual(
            api.metadata.Metadata,
            require("../../lib/metadata"),
        );
        assert.ok(api.defaultOptions());
        assert.strictEqual(api.tracker, require("../../lib/tracker"));
        assert.strictEqual(typeof api.tracker.RequestTracker, "function");
        assert.strictEqual(typeof api.tracker.RequestLogger, "function");

        assert.ok(api.metrics);
        assert.strictEqual(typeof api.metrics.ClientMetrics, "function");
        assert.strictEqual(api.metrics.ClientMetrics.name, "ClientMetrics");
        assert.strictEqual(typeof api.metrics.DefaultMetrics, "function");
        assert.strictEqual(api.metrics.DefaultMetrics.name, "DefaultMetrics");

        assert.ok(api.concurrent);
        assert.strictEqual(typeof api.concurrent.executeConcurrent, "function");
    });
});

function assertConstructorExposed(obj, constructorRef) {
    assert.ok(obj);
    assert.strictEqual(typeof constructorRef, "function");
    // Verify that is exposed with the same name as the class
    assert.strictEqual(obj[constructorRef.name], constructorRef);
}
