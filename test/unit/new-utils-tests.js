"use strict";
const { assert } = require("chai");
const { bigintToLong } = require("../../lib/new-utils");
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
