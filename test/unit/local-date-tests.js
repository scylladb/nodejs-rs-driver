"use strict";
const assert = require("assert");
const types = require("../../lib/types");
const LocalDate = types.LocalDate;

describe("LocalDate", function () {
    describe("new LocalDate", function () {
        it("should refuse to create LocalDate from invalid values.", function () {
            assert.throws(() => new types.LocalDate(), Error);
            assert.throws(() => new types.LocalDate(undefined), Error);
            // Outside of ES5 Date range.
            assert.throws(() => new types.LocalDate(-271821, 4, 19), Error);
            assert.throws(() => new types.LocalDate(275760, 9, 14), Error);
            // Outside of LocalDate range.
            assert.throws(() => new types.LocalDate(-2147483649), Error);
            assert.throws(() => new types.LocalDate(2147483648), Error);
            // Incorrect values for the date.
            assert.throws(() => new types.LocalDate(2024, 13, 14), Error);
            assert.throws(() => new types.LocalDate(2024, 10, 83), Error);
            assert.throws(() => new types.LocalDate(2024, 4, 31), Error);
            assert.throws(() => new types.LocalDate(2023, 2, 29), Error);
        });
    });
    describe("#utcNow()", function () {
        it("should return the current UTC date", function () {
            const before = new Date().toISOString().slice(0, 10);
            const result = LocalDate.utcNow();
            const after = new Date().toISOString().slice(0, 10);

            assert.ok(result instanceof LocalDate);
            // Accept either side of a midnight rollover during the test run
            assert.ok(
                result.toString() === before || result.toString() === after,
                `utcNow() returned ${result.toString()}, expected ${before} or ${after}`,
            );
        });
    });
    describe("#toString()", function () {
        it("should return the string in the form of yyyy-mm-dd", function () {
            assert.strictEqual(
                new LocalDate(2015, 2, 1).toString(),
                "2015-02-01",
            );
            assert.strictEqual(
                new LocalDate(2015, 12, 13).toString(),
                "2015-12-13",
            );
            assert.strictEqual(
                new LocalDate(101, 12, 14).toString(),
                "0101-12-14",
            );
            assert.strictEqual(
                new LocalDate(-100, 11, 6).toString(),
                "-0100-11-06",
            );
        });
    });
    describe("#fromBuffer() and #toBuffer()", function () {
        it("should encode and decode a LocalDate", function () {
            const value = new LocalDate(2010, 8, 5);
            const encoded = value.toBuffer();
            const decoded = LocalDate.fromBuffer(encoded);
            assert.strictEqual(decoded.toString(), value.toString());
            assert.ok(decoded.equals(value));
            assert.ok(value.equals(decoded));
        });
    });
    describe("number of days since the epoch (member value)", function () {
        it("should return the correct number of days from the epoch", function () {
            [
                ["1970-01-01", 0],
                ["1970-01-02", 1],
                ["2024-12-09", 20066],
                ["21-2-1", -711826],
                ["-21-2-1", -727167],
                ["2010-4-29", 14728],
                ["-199-06-30", -792031],
                ["1201-04-03", -280779],
                ["-1201-04-03", -1158092],
                ["0-1-1", -719528],
                ["1200-12-30", -280873],
                ["3096-12-31", 411628],
                ["2024-02-29", 19782],
                ["2024-03-01", 19783],
            ].forEach(function (item) {
                const value = LocalDate.fromString(item[0]);
                assert.strictEqual(value.value, item[1]);
            });
        });
    });
    describe("#fromString()", function () {
        it("should parse the string representation as yyyy-mm-dd", function () {
            [
                ["1200-12-30", 1200, 12, 30],
                ["1-1-1", 1, 1, 1],
                ["21-2-1", 21, 2, 1],
                ["-21-2-1", -21, 2, 1],
                ["2010-4-29", 2010, 4, 29],
                ["-199-06-30", -199, 6, 30],
                ["1201-04-03", 1201, 4, 3],
                ["-1201-04-03", -1201, 4, 3],
                ["0-1-1", 0, 1, 1],
            ].forEach(function (item) {
                const value = LocalDate.fromString(item[0]);
                assert.strictEqual(value.year, item[1]);
                assert.strictEqual(value.month, item[2]);
                assert.strictEqual(value.day, item[3]);
            });
        });
        it("should parse the string representation as since epoch days", function () {
            [
                ["0", "1970-01-01"],
                ["1", "1970-01-02"],
                ["2147483647", "2147483647"],
                ["-2147483648", "-2147483648"],
                ["-719162", "0001-01-01"],
            ].forEach(function (item) {
                const value = LocalDate.fromString(item[0]);
                assert.strictEqual(value.toString(), item[1]);
            });
        });
        it("should throw when string representation is invalid", function () {
            ["", "1880-1", "1880-1-z", undefined, null, "  "].forEach(
                function (value) {
                    assert.throws(function () {
                        LocalDate.fromString(value);
                    });
                },
            );
        });
    });
    describe("setters", function () {
        it("should throw errors", function () {
            const val = LocalDate.fromString("2024-11-29");
            assert.throws(
                function () {
                    val.year += 2;
                },
                {
                    name: "SyntaxError",
                    message: "LocalDate year is read-only",
                },
            );
            assert.throws(
                function () {
                    val.month += 1;
                },
                {
                    name: "SyntaxError",
                    message: "LocalDate month is read-only",
                },
            );
            assert.throws(
                function () {
                    val.day += 3;
                },
                {
                    name: "SyntaxError",
                    message: "LocalDate day is read-only",
                },
            );
            assert.throws(
                function () {
                    val._value += 7;
                },
                {
                    name: "SyntaxError",
                    message: "LocalDate _value is read-only",
                },
            );
            assert.throws(
                function () {
                    val.value += 4;
                },
                {
                    name: "SyntaxError",
                    message: "LocalDate value is read-only",
                },
            );
            assert.throws(
                function () {
                    val.date = new Date();
                },
                {
                    name: "SyntaxError",
                    message: "LocalDate date is read-only",
                },
            );
        });
    });
});
