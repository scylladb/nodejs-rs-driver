"use strict";

const assert = require("assert");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const sinon = require("sinon");
const v8 = require("v8");
const helper = require("../test-helper");
const utils = require("../../lib/utils");
const Uuid = require("../../lib/types").Uuid;
const TimeUuid = require("../../lib/types").TimeUuid;

function withFreshModule(path, check) {
    const paths = [
        require.resolve("../../lib/types/entropy-cache"),
        require.resolve("../../lib/types/uuid"),
        require.resolve("../../lib/types/time-uuid"),
    ];
    const originalModules = paths.map((freshPath) => require.cache[freshPath]);
    try {
        for (const freshPath of paths) delete require.cache[freshPath];
        check(require(path));
    } finally {
        paths.forEach((freshPath, i) => {
            if (originalModules[i]) {
                require.cache[freshPath] = originalModules[i];
            } else {
                delete require.cache[freshPath];
            }
        });
    }
}

function withSnapshotCallbacks(path, check) {
    const building = sinon
        .stub(v8.startupSnapshot, "isBuildingSnapshot")
        .returns(true);
    const serialize = sinon.stub(v8.startupSnapshot, "addSerializeCallback");
    const deserialize = sinon.stub(
        v8.startupSnapshot,
        "addDeserializeCallback",
    );
    const fill = sinon.spy(crypto, "randomFillSync");
    try {
        withFreshModule(path, (Type) => {
            assert.strictEqual(serialize.callCount, 1);
            assert.strictEqual(deserialize.callCount, 1);
            check(Type, { serialize, deserialize, fill });
        });
    } finally {
        fill.restore();
        deserialize.restore();
        serialize.restore();
        building.restore();
    }
}

describe("Uuid", function () {
    describe("constructor", function () {
        it("should validate the Buffer length", function () {
            assert.throws(function () {
                return new Uuid(utils.allocBufferUnsafe(10));
            });
            assert.throws(function () {
                return new Uuid(null);
            });
            assert.throws(function () {
                return new Uuid();
            });
            assert.doesNotThrow(function () {
                return new Uuid(utils.allocBufferUnsafe(16));
            });
        });
    });
    describe("#toString()", function () {
        it("should convert to string representation", function () {
            let val = new Uuid(
                utils.allocBufferFromString(
                    "aabbccddeeff00112233445566778899",
                    "hex",
                ),
            );
            assert.strictEqual(
                val.toString(),
                "aabbccdd-eeff-0011-2233-445566778899",
            );
            val = new Uuid(
                utils.allocBufferFromString(
                    "a1b1ccddeeff00112233445566778899",
                    "hex",
                ),
            );
            assert.strictEqual(
                val.toString(),
                "a1b1ccdd-eeff-0011-2233-445566778899",
            );
            val = new Uuid(
                utils.allocBufferFromString(
                    "ffb1ccddeeff00112233445566778800",
                    "hex",
                ),
            );
            assert.strictEqual(
                val.toString(),
                "ffb1ccdd-eeff-0011-2233-445566778800",
            );
        });
    });
    describe("#equals", function () {
        it("should return true only when the values are equal", function () {
            const val = new Uuid(
                utils.allocBufferFromString(
                    "aabbccddeeff00112233445566778899",
                    "hex",
                ),
            );
            const val2 = new Uuid(
                utils.allocBufferFromString(
                    "ffffffffffff00000000000000000000",
                    "hex",
                ),
            );
            const val3 = new Uuid(
                utils.allocBufferFromString(
                    "ffffffffffff00000000000000000001",
                    "hex",
                ),
            );
            assert.strictEqual(val.equals(val), true);
            assert.strictEqual(
                val.equals(
                    new Uuid(
                        utils.allocBufferFromString(
                            "aabbccddeeff00112233445566778899",
                            "hex",
                        ),
                    ),
                ),
                true,
            );
            assert.strictEqual(val.equals(val2), false);
            assert.strictEqual(val.equals(val3), false);
            assert.strictEqual(val2.equals(val3), false);
            assert.strictEqual(val3.equals(val2), false);
        });
    });
    describe("#getBuffer()", function () {
        it("should return the Buffer representation", function () {
            let buf = utils.allocBufferUnsafe(16);
            let val = new Uuid(buf);
            assert.strictEqual(
                val.getBuffer().toString("hex"),
                buf.toString("hex"),
            );
            buf = utils.allocBufferFromString(
                "ffffccddeeff00222233445566778813",
                "hex",
            );
            val = new Uuid(buf);
            assert.strictEqual(
                val.getBuffer().toString("hex"),
                buf.toString("hex"),
            );
        });
    });
    describe("fromString()", function () {
        it("should validate the string", function () {
            assert.throws(function () {
                Uuid.fromString("22");
            });
            assert.throws(function () {
                Uuid.fromString(null);
            });
            assert.throws(function () {
                Uuid.fromString();
            });
            assert.throws(function () {
                Uuid.fromString("zzb1ccdd-eeff-0011-2233-445566778800");
            });
            assert.doesNotThrow(function () {
                Uuid.fromString("acb1ccdd-eeff-0011-2233-445566778813");
            });
        });
        it("should contain a valid internal representation", function () {
            let val = Uuid.fromString("acb1ccdd-eeff-0011-2233-445566778813");
            assert.strictEqual(
                val.buffer.toString("hex"),
                "acb1ccddeeff00112233445566778813",
            );
            val = Uuid.fromString("ffffccdd-eeff-0022-2233-445566778813");
            assert.strictEqual(
                val.buffer.toString("hex"),
                "ffffccddeeff00222233445566778813",
            );
        });
    });
    describe("random()", function () {
        this.timeout(20000);
        it("should set version and variant bits across cache refills", function () {
            const fill = sinon.spy(crypto, "randomFillSync");
            try {
                for (let i = 0; i < 384; i++) {
                    const value = Uuid.random();
                    assert.strictEqual(value.buffer[6] >> 4, 4);
                    assert.strictEqual(value.buffer[8] >> 6, 2);
                }
                assert.ok(fill.callCount >= 2);
            } finally {
                fill.restore();
            }
        });
        it("should discard cached entropy before serializing a startup snapshot", function () {
            const uuidPath = require.resolve("../../lib/types/uuid");
            withSnapshotCallbacks(
                uuidPath,
                (SnapshotUuid, { serialize, deserialize, fill }) => {
                    const first = SnapshotUuid.random();
                    const firstBytes = Buffer.from(first.buffer);
                    assert.strictEqual(fill.callCount, 1);
                    serialize.firstCall.args[0]();
                    const second = SnapshotUuid.random();
                    assert.strictEqual(fill.callCount, 2);
                    deserialize.firstCall.args[0]();
                    SnapshotUuid.random();
                    assert.strictEqual(fill.callCount, 3);
                    assert.deepStrictEqual(first.buffer, firstBytes);
                    assert.strictEqual(second.buffer[6] >> 4, 4);
                },
            );
        });
        it("should reuse random fills without sharing output buffers", function () {
            const fill = sinon.spy(crypto, "randomFillSync");
            try {
                let first;
                for (let i = 0; i < 193 && !first; i++) {
                    const value = Uuid.random();
                    if (fill.callCount === 1) first = value;
                }
                assert.ok(first);
                const second = Uuid.random();
                const secondBytes = Buffer.from(second.buffer);
                assert.strictEqual(first.buffer.byteOffset, 0);
                assert.strictEqual(first.buffer.buffer.byteLength, 16);
                first.buffer.fill(0);
                assert.deepStrictEqual(second.buffer, secondBytes);
                for (let i = 0; i < 190; i++) Uuid.random();
                assert.strictEqual(fill.callCount, 1);
                Uuid.random();
                assert.strictEqual(fill.callCount, 2);
                assert.deepStrictEqual(first.buffer, Buffer.alloc(16));
                assert.deepStrictEqual(second.buffer, secondBytes);
            } finally {
                fill.restore();
            }
        });
        it("should return a Uuid instance", function () {
            helper.assertInstanceOf(Uuid.random(), Uuid);
        });
        it("should contain the version bits and IETF variant", function () {
            let val = Uuid.random();
            assert.strictEqual(val.toString().charAt(14), "4");
            assert.ok(
                ["8", "9", "a", "b"].indexOf(val.toString().charAt(19)) >= 0,
            );
            val = Uuid.random();
            assert.strictEqual(val.toString().charAt(14), "4");
            assert.ok(
                ["8", "9", "a", "b"].indexOf(val.toString().charAt(19)) >= 0,
            );
            val = Uuid.random();
            assert.strictEqual(val.toString().charAt(14), "4");
            assert.ok(
                ["8", "9", "a", "b"].indexOf(val.toString().charAt(19)) >= 0,
            );
        });
        it("should generate v4 uuids that do not collide", function () {
            const values = {};
            const length = 100000;
            for (let i = 0; i < length; i++) {
                values[Uuid.random().toString()] = true;
            }
            assert.strictEqual(Object.keys(values).length, length);
        });
    });

    describe("random(cb)", function () {
        this.timeout(20000);
        const sandbox = sinon.createSandbox();

        afterEach(() => sandbox.restore());

        it("should defer callbacks on cache refills and cache hits", async function () {
            let CachedUuid;
            withFreshModule(require.resolve("../../lib/types/uuid"), (Type) => {
                CachedUuid = Type;
            });
            for (let i = 0; i < 2; i++) {
                let returned = false;
                const completed = new Promise((resolve, reject) => {
                    const result = CachedUuid.random((err, value) => {
                        try {
                            assert.ifError(err);
                            assert.strictEqual(returned, true);
                            helper.assertInstanceOf(value, CachedUuid);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                    assert.strictEqual(result, undefined);
                    returned = true;
                });
                await completed;
            }
        });
        it("should report a failed cache refill asynchronously and retry on the next call", async function () {
            let CachedUuid;
            withFreshModule(require.resolve("../../lib/types/uuid"), (Type) => {
                CachedUuid = Type;
            });
            const failure = new Error("random fill failed");
            const originalFill = crypto.randomFillSync;
            let fills = 0;
            const fill = sinon
                .stub(crypto, "randomFillSync")
                .callsFake((buffer) => {
                    if (fills++ === 0) throw failure;
                    return originalFill(buffer);
                });
            try {
                let returned = false;
                const completed = new Promise((resolve, reject) => {
                    CachedUuid.random((err, value) => {
                        try {
                            assert.strictEqual(returned, true);
                            assert.strictEqual(err, failure);
                            assert.strictEqual(value, undefined);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                    returned = true;
                });
                await completed;
                assert.strictEqual(fill.callCount, 1);
                const recovered = CachedUuid.random();
                assert.strictEqual(recovered.buffer[6] >> 4, 4);
                assert.strictEqual(recovered.buffer[8] >> 6, 2);
                assert.strictEqual(fill.callCount, 2);
            } finally {
                fill.restore();
            }
        });
        it("should reject a non-function callback before generating a UUID", function () {
            const fill = sandbox.spy(crypto, "randomFillSync");
            assert.throws(() => Uuid.random({}), {
                name: "ArgumentError",
                message: "callback is not a function",
            });
            assert.strictEqual(fill.callCount, 0);
        });
        it("should not invoke a throwing callback twice", function () {
            const output = execFileSync(
                process.execPath,
                [
                    "-e",
                    `
                    const assert = require("assert");
                    const Uuid = require(process.argv[1]);
                    const failure = new Error("callback failure");
                    let calls = 0;
                    process.once("uncaughtException", (err) => {
                        assert.strictEqual(err, failure);
                        setImmediate(() => {
                            assert.strictEqual(calls, 1);
                            process.stdout.write("once");
                        });
                    });
                    Uuid.random(() => {
                        calls++;
                        throw failure;
                    });
                    `,
                    require.resolve("../../lib/types/uuid"),
                ],
                { encoding: "utf8", timeout: 5000 },
            );
            assert.strictEqual(output, "once");
        });
        it("should return a Uuid instance", function (done) {
            Uuid.random(function (err, uuid) {
                helper.assertInstanceOf(uuid, Uuid);
                done();
            });
        });
        it("should contain the version bits and IETF variant", function (done) {
            Uuid.random(function (err, val) {
                assert.strictEqual(val.toString().charAt(14), "4");
                assert.ok(
                    ["8", "9", "a", "b"].indexOf(val.toString().charAt(19)) >=
                        0,
                );
                Uuid.random(function (err, val) {
                    assert.strictEqual(val.toString().charAt(14), "4");
                    assert.ok(
                        ["8", "9", "a", "b"].indexOf(
                            val.toString().charAt(19),
                        ) >= 0,
                    );
                    Uuid.random(function (err, val) {
                        assert.strictEqual(val.toString().charAt(14), "4");
                        assert.ok(
                            ["8", "9", "a", "b"].indexOf(
                                val.toString().charAt(19),
                            ) >= 0,
                        );
                        done();
                    });
                });
            });
        });
        it("should generate v4 uuids that do not collide", function (done) {
            const values = {};
            const length = 100000;

            utils.times(
                length,
                function eachTime(n, next) {
                    Uuid.random(function (err, val) {
                        if (err) {
                            return next(err);
                        }
                        values[val.toString()] = true;
                        next();
                    });
                },
                function finish(err) {
                    assert.ifError(err);
                    assert.strictEqual(Object.keys(values).length, length);
                    done();
                },
            );
        });
    });

    describe("setter errors", function () {
        it("should validate if setter throws an error", function () {
            assert.throws(
                function () {
                    let uuid = Uuid.fromString(
                        "ffffffff-ffff-ffff-ffff-ffffffffffff",
                    );
                    uuid.buffer = "00000000-0000-0000-0000-000000000000";
                },
                {
                    name: "SyntaxError",
                    message: "UUID buffer is read-only",
                },
            );
        });
    });
});

describe("TimeUuid", function () {
    describe("constructor()", function () {
        it("should generate based on the parameters", function () {
            // Gregorian calendar epoch
            let val = new TimeUuid(
                new Date(-12219292800000),
                0,
                utils.allocBufferFromArray([0, 0, 0, 0, 0, 0]),
                utils.allocBufferFromArray([0, 0]),
            );
            assert.strictEqual(
                val.toString(),
                "00000000-0000-1000-8000-000000000000",
            );
            val = new TimeUuid(
                new Date(-12219292800000 + 1000),
                0,
                utils.allocBufferFromArray([0, 0, 0, 0, 0, 0]),
                utils.allocBufferFromArray([0, 0]),
            );
            assert.strictEqual(
                val.toString(),
                "00989680-0000-1000-8000-000000000000",
            );
            // unix  epoch
            val = new TimeUuid(
                new Date(0),
                0,
                utils.allocBufferFromArray([0, 0, 0, 0, 0, 0]),
                utils.allocBufferFromArray([0, 0]),
            );
            assert.strictEqual(
                val.toString(),
                "13814000-1dd2-11b2-8000-000000000000",
            );
            val = new TimeUuid(
                new Date(0),
                0,
                utils.allocBufferFromArray([255, 255, 255, 255, 255, 255]),
                utils.allocBufferFromArray([255, 255]),
            );
            assert.strictEqual(
                val.toString(),
                "13814000-1dd2-11b2-bfff-ffffffffffff",
            );
            val = new TimeUuid(
                new Date(0),
                0,
                utils.allocBufferFromArray([1, 1, 1, 1, 1, 1]),
                utils.allocBufferFromArray([1, 1]),
            );
            assert.strictEqual(
                val.toString(),
                "13814000-1dd2-11b2-8101-010101010101",
            );

            val = new TimeUuid(
                new Date("2015-01-10 5:05:05 GMT+0000"),
                0,
                utils.allocBufferFromArray([1, 1, 1, 1, 1, 1]),
                utils.allocBufferFromArray([1, 1]),
            );
            assert.strictEqual(
                val.toString(),
                "3d555680-9886-11e4-8101-010101010101",
            );
        });
    });
    describe("#getDatePrecision()", function () {
        it("should get the Date and ticks of the Uuid representation", function () {
            let date = new Date();
            let val = new TimeUuid(date, 1);
            assert.strictEqual(val.getDatePrecision().ticks, 1);
            assert.strictEqual(
                val.getDatePrecision().date.getTime(),
                date.getTime(),
            );

            date = new Date("2015-02-13 06:07:08.450");
            val = new TimeUuid(date, 699);
            assert.strictEqual(val.getDatePrecision().ticks, 699);
            assert.strictEqual(
                val.getDatePrecision().date.getTime(),
                date.getTime(),
            );
            assert.strictEqual(val.getDate().getTime(), date.getTime());
        });
    });
    describe("#getNodeId()", function () {
        it("should get the node id of the Uuid representation", function () {
            let val = new TimeUuid(
                new Date(),
                0,
                utils.allocBufferFromArray([1, 2, 3, 4, 5, 6]),
            );
            helper.assertInstanceOf(val.getNodeId(), Buffer);
            assert.strictEqual(val.getNodeId().toString("hex"), "010203040506");
            val = new TimeUuid(new Date(), 0, "host01");
            assert.strictEqual(val.getNodeIdString(), "host01");
            val = new TimeUuid(new Date(), 0, "h12288");
            assert.strictEqual(val.getNodeIdString(), "h12288");
        });
    });
    describe("fromDate()", function () {
        this.timeout(5000);
        it("should generate v1 uuids that do not collide", function () {
            const values = {};
            const length = 50000;
            const date = new Date();
            for (let i = 0; i < length; i++) {
                values[TimeUuid.fromDate(date).toString()] = true;
            }
            assert.strictEqual(Object.keys(values).length, length);
        });
        it("should collide exactly at 10001 if date but not the ticks are specified", function () {
            const values = {};
            const length = 10000;
            const date = new Date();
            for (let i = 0; i < length; i++) {
                values[
                    TimeUuid.fromDate(date, null, "host01", "AA").toString()
                ] = true;
            }
            assert.strictEqual(Object.keys(values).length, length);
            // next should collide
            assert.strictEqual(
                values[
                    TimeUuid.fromDate(date, null, "host01", "AA").toString()
                ],
                true,
            );
        });

        context("with callback defined", () => {
            const date = new Date();
            const ticks = 123;
            const nodeId = "myHost";
            const clockId = "zz";

            function assertTimeUuidFunction(portions, callback) {
                return function assertTimeUuid(err, id) {
                    assert.ifError(err);
                    helper.assertInstanceOf(id, TimeUuid);
                    assert.strictEqual(id.getDate().getTime(), date.getTime());

                    if (portions > 1) {
                        assert.strictEqual(id.getDatePrecision().ticks, ticks);
                    }

                    if (portions > 2) {
                        assert.strictEqual(id.getNodeId().toString(), nodeId);
                    }

                    if (portions > 3) {
                        assert.strictEqual(
                            id.getClockId().toString().slice(1),
                            clockId.slice(1),
                        );
                    }
                    callback();
                };
            }

            it("should support callback as second parameter", (done) =>
                TimeUuid.fromDate(date, assertTimeUuidFunction(1, done)));

            it("should support callback as third parameter", (done) =>
                TimeUuid.fromDate(
                    date,
                    ticks,
                    assertTimeUuidFunction(2, done),
                ));

            it("should support callback as forth parameter", (done) =>
                TimeUuid.fromDate(
                    date,
                    ticks,
                    nodeId,
                    assertTimeUuidFunction(3, done),
                ));

            it("should support callback as fifth parameter", (done) =>
                TimeUuid.fromDate(
                    date,
                    ticks,
                    nodeId,
                    clockId,
                    assertTimeUuidFunction(4, done),
                ));
        });
    });

    describe("fromString()", function () {
        it("should parse the string representation", function () {
            const text = "3d555680-9886-11e4-8101-010101010101";
            const val = TimeUuid.fromString(text);
            helper.assertInstanceOf(val, TimeUuid);
            assert.strictEqual(val.toString(), text);
            assert.strictEqual(
                val.getDate().getTime(),
                new Date("2015-01-10 5:05:05 GMT+0000").getTime(),
            );
        });
    });

    describe("now()", function () {
        it("should pass the nodeId when provided", function () {
            const val = TimeUuid.now("h12345");
            assert.strictEqual(val.getNodeIdString(), "h12345");
        });
        it("should use current date", function () {
            const startDate = new Date().getTime();
            const val = TimeUuid.now().getDate().getTime();
            const endDate = new Date().getTime();
            assert.ok(val >= startDate);
            assert.ok(val <= endDate);
        });
        it("should reset the ticks portion of the TimeUuid to zero when the time progresses", function () {
            const firstTimeUuid = TimeUuid.now();
            let secondTimeUuid = TimeUuid.now();
            while (
                firstTimeUuid.getDate().getTime() ===
                secondTimeUuid.getDate().getTime()
            ) {
                secondTimeUuid = TimeUuid.now();
            }
            assert.strictEqual(secondTimeUuid.getDatePrecision().ticks, 0);
        });

        context("with callback defined", () => {
            const startDate = new Date();
            const nodeId = "aHost1";
            const clockId = "ab";
            const sandbox = sinon.createSandbox();

            afterEach(() => sandbox.restore());

            function assertTimeUuidFunction(portions, callback) {
                return function assertTimeUuid(err, id) {
                    assert.ifError(err);
                    helper.assertInstanceOf(id, TimeUuid);
                    assert.ok(id.getDate() >= startDate);
                    assert.ok(id.getDate() <= new Date());

                    if (portions > 0) {
                        assert.strictEqual(id.getNodeId().toString(), nodeId);
                    }

                    if (portions > 1) {
                        assert.strictEqual(
                            id.getClockId().toString().slice(1),
                            clockId.slice(1),
                        );
                    }

                    callback();
                };
            }

            it("should support callback as first parameter", (done) =>
                TimeUuid.now(assertTimeUuidFunction(0, done)));

            it("should report validation errors asynchronously with any supplied IDs", async () => {
                const cases = [
                    [Buffer.alloc(5), null, /Node identifier/],
                    [Buffer.alloc(5), "02", /Node identifier/],
                    [null, Buffer.alloc(1), /Clock identifier/],
                    ["host01", Buffer.alloc(1), /Clock identifier/],
                ];
                for (const method of ["now", "fromDate"]) {
                    for (const [nodeId, clockId, message] of cases) {
                        let returned = false;
                        let calls = 0;
                        await new Promise((resolve, reject) => {
                            const callback = (err, value) => {
                                calls++;
                                try {
                                    assert.strictEqual(returned, true);
                                    assert.match(err.message, message);
                                    assert.strictEqual(value, undefined);
                                    resolve();
                                } catch (e) {
                                    reject(e);
                                }
                            };
                            const args = [nodeId, clockId, callback];
                            if (method === "fromDate")
                                args.unshift(new Date(0), 0);
                            assert.strictEqual(
                                TimeUuid[method](...args),
                                undefined,
                            );
                            returned = true;
                        });
                        await new Promise((resolve) => setImmediate(resolve));
                        assert.strictEqual(calls, 1);
                    }
                }
            });

            it("should complete asynchronously with any supplied IDs without synchronous random filling", async () => {
                const fill = sandbox.spy(crypto, "randomBytes");
                for (const method of ["now", "fromDate"]) {
                    for (const [nodeId, clockId] of [
                        [null, null],
                        ["host01", null],
                        [null, "02"],
                        ["host01", "02"],
                    ]) {
                        fill.resetHistory();
                        let returned = false;
                        await new Promise((resolve, reject) => {
                            const callback = (err, value) => {
                                try {
                                    assert.strictEqual(returned, true);
                                    assert.ifError(err);
                                    helper.assertInstanceOf(value, TimeUuid);
                                    resolve();
                                } catch (e) {
                                    reject(e);
                                }
                            };
                            const args = [nodeId, clockId, callback];
                            if (method === "fromDate")
                                args.unshift(new Date(0), 0);
                            assert.strictEqual(
                                TimeUuid[method](...args),
                                undefined,
                            );
                            returned = true;
                        });
                        assert.strictEqual(
                            fill.callCount,
                            Number(!nodeId) + Number(!clockId),
                        );
                        for (const call of fill.getCalls()) {
                            assert.strictEqual(typeof call.args[1], "function");
                        }
                    }
                }
            });

            it("should copy supplied IDs and date before deferring the callback when no randomness is needed", async () => {
                const fill = sandbox.spy(crypto, "randomBytes");
                const date = new Date(0);
                const nodeId = Buffer.from("host01");
                const clockId = Buffer.from("02");
                const completed = new Promise((resolve, reject) => {
                    TimeUuid.fromDate(
                        date,
                        0,
                        nodeId,
                        clockId,
                        (err, value) => {
                            if (err) return reject(err);
                            resolve(value);
                        },
                    );
                });
                date.setTime(1000);
                nodeId.write("host02");
                clockId.write("03");
                const value = await completed;
                assert.strictEqual(value.getDate().getTime(), 0);
                assert.strictEqual(value.getNodeIdString(), "host01");
                assert.strictEqual(value.getClockId()[1], "2".charCodeAt(0));
                assert.strictEqual(fill.callCount, 0);
            });

            it("should defer errors thrown while starting asynchronous random filling", async () => {
                const failure = new Error("random fill dispatch failed");
                sandbox.stub(crypto, "randomBytes").throws(failure);
                let returned = false;
                let calls = 0;
                await new Promise((resolve, reject) => {
                    TimeUuid.now((err, value) => {
                        calls++;
                        try {
                            assert.strictEqual(returned, true);
                            assert.strictEqual(err, failure);
                            assert.strictEqual(value, undefined);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                    returned = true;
                });
                await new Promise((resolve) => setImmediate(resolve));
                assert.strictEqual(calls, 1);
            });

            it("should ignore pending random completion after a dispatch error", async () => {
                const fill = sandbox.stub(crypto, "randomBytes");
                const failure = new Error("second random dispatch failed");
                for (const method of ["now", "fromDate"]) {
                    for (const lateError of [
                        null,
                        new Error("first random operation failed"),
                    ]) {
                        fill.reset();
                        let pending;
                        fill.onFirstCall().callsFake((length, callback) => {
                            pending = callback;
                        });
                        fill.onSecondCall().throws(failure);
                        let returned = false;
                        const received = [];
                        const callback = (err, value) => {
                            received.push({ err, value, returned });
                        };
                        const args = [null, null, callback];
                        if (method === "fromDate") args.unshift(new Date(0), 0);
                        TimeUuid[method](...args);
                        returned = true;
                        await new Promise((resolve) => setImmediate(resolve));
                        pending(
                            lateError,
                            lateError ? undefined : Buffer.alloc(6),
                        );
                        await new Promise((resolve) => setImmediate(resolve));
                        assert.strictEqual(fill.callCount, 2);
                        assert.deepStrictEqual(received, [
                            { err: failure, value: undefined, returned: true },
                        ]);
                    }
                }
            });

            it("should reject a non-function callback before generating IDs with any supplied IDs", () => {
                const fill = sandbox.spy(crypto, "randomBytes");
                for (const method of ["now", "fromDate"]) {
                    for (const [nodeId, clockId] of [
                        [null, null],
                        ["host01", null],
                        [null, "02"],
                        ["host01", "02"],
                    ]) {
                        const args = [nodeId, clockId, {}];
                        if (method === "fromDate") args.unshift(new Date(0), 0);
                        assert.throws(() => TimeUuid[method](...args), {
                            name: "ArgumentError",
                            message: "callback is not a function",
                        });
                    }
                }
                assert.strictEqual(fill.callCount, 0);
            });

            it("should propagate errors thrown while scheduling callback delivery", () => {
                const failure = new Error("callback scheduling failed");
                const callback = sinon.spy();
                const nextTick = sandbox
                    .stub(process, "nextTick")
                    .throws(failure);
                try {
                    for (const method of ["now", "fromDate"]) {
                        const args = ["host01", "02", callback];
                        if (method === "fromDate") args.unshift(new Date(0), 0);
                        assert.throws(() => TimeUuid[method](...args), failure);
                    }
                    assert.strictEqual(callback.callCount, 0);
                } finally {
                    nextTick.restore();
                }
            });

            it("should not invoke a throwing callback twice with supplied or random IDs", function () {
                this.timeout(15000);
                for (const fixed of [false, true]) {
                    const output = execFileSync(
                        process.execPath,
                        [
                            "-e",
                            `
                        const assert = require("assert");
                        const TimeUuid = require(process.argv[1]);
                        const failure = new Error("callback failure");
                        let calls = 0;
                        process.once("uncaughtException", (err) => {
                            assert.strictEqual(err, failure);
                            setImmediate(() => {
                                assert.strictEqual(calls, 1);
                                process.stdout.write("once");
                            });
                        });
                        const callback = () => { calls++; throw failure; };
                        if (process.argv[2] === "true") {
                            TimeUuid.now("host01", "02", callback);
                        } else {
                            TimeUuid.now(callback);
                        }
                    `,
                            require.resolve("../../lib/types/time-uuid"),
                            String(fixed),
                        ],
                        { encoding: "utf8", timeout: 5000 },
                    );
                    assert.strictEqual(output, "once");
                }
            });

            it("should support callback as second parameter", (done) =>
                TimeUuid.now(nodeId, assertTimeUuidFunction(1, done)));

            it("should support callback as third parameter", (done) =>
                TimeUuid.now(nodeId, clockId, assertTimeUuidFunction(2, done)));
        });
    });

    describe("min()", function () {
        it("should generate uuid with the minimum node and clock id values", function () {
            const val = TimeUuid.min(new Date());
            assert.strictEqual(val.getNodeId().toString("hex"), "808080808080");
        });
    });
    describe("max()", function () {
        it("should generate uuid with the maximum node and clock id values", function () {
            const val = TimeUuid.max(new Date());
            assert.strictEqual(val.getNodeId().toString("hex"), "7f7f7f7f7f7f");
        });
    });
});
