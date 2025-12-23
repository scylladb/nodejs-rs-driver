"use strict";
const assert = require("assert");
const types = require("../../lib/types");
const LocalTime = types.LocalTime;
const Long = types.Long;
const util = require("util");

const values = [
    // Long value | string representation | hour/min/sec/nanos
    ["1000000001", "00:00:01.000000001", [0, 0, 1, 1]],
    ["0", "00:00:00", [0, 0, 0, 0]],
    ["3600000006001", "01:00:00.000006001", [1, 0, 0, 6001]],
    ["61000000000", "00:01:01", [0, 1, 1, 0]],
    ["610000030000", "00:10:10.00003", [0, 10, 10, 30000]],
    ["52171800000000", "14:29:31.8", [14, 29, 31, 800000000]],
    ["52171800600000", "14:29:31.8006", [14, 29, 31, 800600000]],
];

describe("LocalTime", function () {
    describe("new LocalTime", function () {
        it("should refuse to create LocalTime from invalid values.", function () {
            // Not a long.
            assert.throws(() => new types.LocalTime(23.0), Error);
            // < 0
            assert.throws(() => new types.LocalTime(types.Long(-1)), Error);
            // > maxNanos
            assert.throws(
                () => new types.LocalTime(Long.fromString("86400000000000")),
                Error,
            );
        });
    });
    describe("#toString()", function () {
        it("should return the string representation", function () {
            values.forEach(function (item) {
                const val = new LocalTime(Long.fromString(item[0]));
                assert.strictEqual(val.toString(), item[1]);
            });
        });
    });
    describe("#toJSON()", function () {
        it("should return the string representation", function () {
            values.forEach(function (item) {
                const val = new LocalTime(Long.fromString(item[0]));
                assert.strictEqual(val.toString(), item[1]);
            });
        });
    });
    describe("#fromString()", function () {
        it("should parse the string representation", function () {
            values.forEach(function (item) {
                const val = LocalTime.fromString(item[1]);
                assert.ok(new LocalTime(Long.fromString(item[0])).equals(val));
                assert.ok(
                    new LocalTime(Long.fromString(item[0]))
                        .getTotalNanoseconds()
                        .equals(val.getTotalNanoseconds()),
                );
            });
        });
    });
    describe("#toBuffer() and fromBuffer()", function () {
        values.forEach(function (item) {
            const val = new LocalTime(Long.fromString(item[0]));
            const encoded = val.toBuffer();
            const decoded = LocalTime.fromBuffer(encoded);
            assert.ok(decoded.equals(val));
            assert.strictEqual(val.toString(), decoded.toString());
        });
    });
    describe("#hour #minute #second #nanosecond", function () {
        it("should get the correct parts", function () {
            values.forEach(function (item) {
                const val = new LocalTime(Long.fromString(item[0]));
                const parts = item[2];
                assert.strictEqual(val.hour, parts[0]);
                assert.strictEqual(val.minute, parts[1]);
                assert.strictEqual(val.second, parts[2]);
                assert.strictEqual(val.nanosecond, parts[3]);
            });
        });
    });
    describe("fromDate()", function () {
        it("should use the local time", function () {
            const date = new Date();
            const time = LocalTime.fromDate(date, 1);
            assert.strictEqual(time.hour, date.getHours());
            assert.strictEqual(time.minute, date.getMinutes());
            assert.strictEqual(time.second, date.getSeconds());
            assert.strictEqual(
                time.nanosecond,
                date.getMilliseconds() * 1000000 + 1,
            );
        });
    });
    describe("fromMilliseconds", function () {
        it("should default nanoseconds to 0 when not provided", function () {
            const time = LocalTime.fromMilliseconds(1);
            assert.ok(time.equals(LocalTime.fromMilliseconds(1, 0)));
        });
    });
    describe("setters", function () {
        it("should throw errors", function () {
            values.forEach(function (item) {
                const val = new LocalTime(Long.fromString("0"));
                const parts = item[2];
                assert.throws(
                    function () {
                        val.hour += parts[0];
                    },
                    {
                        name: "SyntaxError",
                        message: "LocalTime hour is read-only",
                    },
                );
                assert.throws(
                    function () {
                        val.minute += parts[1];
                    },
                    {
                        name: "SyntaxError",
                        message: "LocalTime minute is read-only",
                    },
                );
                assert.throws(
                    function () {
                        val.second += parts[2];
                    },
                    {
                        name: "SyntaxError",
                        message: "LocalTime second is read-only",
                    },
                );
                assert.throws(
                    function () {
                        val.nanosecond += parts[3];
                    },
                    {
                        name: "SyntaxError",
                        message: "LocalTime nanosecond is read-only",
                    },
                );
            });
        });
    });
    describe("fromString() Errors", function () {
        it("should throw TypeError if the format is incorrect", function () {
            const valuesError = [
                "-5:",
                ";",
                "27:87:96",
                "020:60:65.01",
                "23:50:00.0000000000000001",
            ];
            valuesError.forEach(function (item) {
                assert.throws(
                    function () {
                        let _ = LocalTime.fromString(item);
                    },
                    {
                        name: "TypeError",
                    },
                );
            });
        });
        it("should throw TypeError if the object is not string", function () {
            const valuesError = [
                -5,
                300,
                new LocalTime(Long.fromString("500")),
                [0, 0, 1, 1],
                null,
            ];
            valuesError.forEach(function (item) {
                assert.throws(
                    function () {
                        let _ = LocalTime.fromString(item);
                    },
                    {
                        name: "TypeError",
                        message: `Argument type invalid: ${util.inspect(item)}, expected string type`,
                    },
                );
            });
        });
    });
});
