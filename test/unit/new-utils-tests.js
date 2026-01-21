"use strict";
const { assert } = require("chai");
const {
    bigintToLong,
    ensure32SignedInteger,
    ensure64SignedInteger,
} = require("../../lib/new-utils");
const Long = require("long");

const values = [
    "0",
    "1",
    "-1",
    "12",
    "-12",
    "20040400020",
    "120000000000",
    "9223372036854775807",
    "9223372036854775806",
    "-9223372036854775808",
    "-9223372036854775805",
    "-20040400020",
];

describe("Numeric types conversions", function () {
    // We assume BigInt and Long are fully correct
    describe("BigInt to Long", function () {
        it("should convert correctly", function () {
            values.forEach((value) => {
                let bigInt = BigInt(value);
                let long = bigintToLong(bigInt);
                assert.strictEqual(value, long.toString());
            });
        });
    });
    describe("Long to BigInt", function () {
        it("should convert correctly", function () {
            values.forEach((value) => {
                let long = Long.fromString(value);
                let bigInt = long.toBigInt();
                assert.strictEqual(value, bigInt.toString());
            });
        });
    });
});

describe("ensure32SignedInteger", function () {
    it("should accept valid 32-bit signed integers", function () {
        const validValues = [
            0, 1, -1, 100, -100, 1000000, -1000000, 0x7fffffff, -0x80000000,
        ];
        validValues.forEach((value) => {
            assert.doesNotThrow(() => {
                ensure32SignedInteger(value, "testValue");
            });
        });
    });

    it("should accept BigInt values within 32-bit range", function () {
        const validBigInts = [
            BigInt(0),
            BigInt(1),
            BigInt(-1),
            BigInt(0x7fffffff),
            BigInt(-0x80000000),
        ];
        validBigInts.forEach((value) => {
            assert.doesNotThrow(() => {
                ensure32SignedInteger(value, "testValue");
            });
        });
    });

    it("should throw TypeError when value is greater than max int32", function () {
        const invalidValues = [
            0x7fffffff + 1,
            0x80000000,
            0xffffffff,
            10000000000,
            BigInt(0x7fffffff) + BigInt(1),
        ];
        invalidValues.forEach((value) => {
            assert.throws(
                () => {
                    ensure32SignedInteger(value, "testValue");
                },
                TypeError,
                /testValue was expected to be 32bit integer/,
            );
        });
    });

    it("should throw TypeError when value is less than min int32", function () {
        const invalidValues = [
            -0x80000000 - 1,
            -0x80000001,
            -10000000000,
            BigInt(-0x80000000) - BigInt(1),
        ];
        invalidValues.forEach((value) => {
            assert.throws(
                () => {
                    ensure32SignedInteger(value, "testValue");
                },
                TypeError,
                /testValue was expected to be 32bit integer/,
            );
        });
    });

    it("should use the provided name in error messages", function () {
        assert.throws(
            () => {
                ensure32SignedInteger(0x80000000, "customName");
            },
            TypeError,
            /customName was expected to be 32bit integer/,
        );
    });
});

describe("ensure64SignedInteger", function () {
    it("should accept valid 64-bit signed integers", function () {
        const validValues = [
            BigInt(0),
            BigInt(1),
            BigInt(-1),
            BigInt(100),
            BigInt(-100),
            BigInt("9223372036854775807"),
            BigInt("-9223372036854775808"),
            BigInt("1000000000000"),
            BigInt("-1000000000000"),
        ];
        validValues.forEach((value) => {
            assert.doesNotThrow(() => {
                ensure64SignedInteger(value, "testValue");
            });
        });
    });

    it("should throw TypeError when value is greater than max int64", function () {
        const invalidValues = [
            BigInt("9223372036854775807") + BigInt(1), // max + 1
            BigInt("9223372036854775808"),
            BigInt("10000000000000000000"),
        ];
        invalidValues.forEach((value) => {
            assert.throws(
                () => {
                    ensure64SignedInteger(value, "testValue");
                },
                TypeError,
                /testValue was expected to be 64bit integer/,
            );
        });
    });

    it("should throw TypeError when value is less than min int64", function () {
        const invalidValues = [
            BigInt("-9223372036854775808") - BigInt(1), // min - 1
            BigInt("-9223372036854775809"),
            BigInt("-10000000000000000000"),
        ];
        invalidValues.forEach((value) => {
            assert.throws(
                () => {
                    ensure64SignedInteger(value, "testValue");
                },
                TypeError,
                /testValue was expected to be 64bit integer/,
            );
        });
    });

    it("should use the provided name in error messages", function () {
        assert.throws(
            () => {
                ensure64SignedInteger(
                    BigInt("9223372036854775808"),
                    "customName",
                );
            },
            TypeError,
            /customName was expected to be 64bit integer/,
        );
    });
});
