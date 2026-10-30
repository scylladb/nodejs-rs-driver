"use strict";

const { assert } = require("chai");
const { cases, makeEncoders, encodeCase } = require("./fixtures/encoder-cases");
const frozen = require("./fixtures/encoder-bytes.json");

describe("Encoder.encode with the frozen encodings", function () {
    const encoders = makeEncoders();

    it("has frozen bytes for each case", function () {
        assert.sameMembers(
            Object.keys(frozen),
            cases.map((c) => c[0]),
        );
    });

    it("gives the frozen bytes and errors", function () {
        for (const c of cases) {
            assert.deepEqual(encodeCase(encoders, c), frozen[c[0]], c[0]);
        }
    });
});
