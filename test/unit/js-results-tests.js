"use strict";
const { assert } = require("chai");

const rust = require("../../index");
const helper = require("../test-helper");

describe("JsResult", function () {
    it("should get the JsResult::Ok correctly", function () {
        assert.strictEqual(rust.testsReturnJsResult(1), 1);
    });
    it("should get the correct error from JsResult::Error", function () {
        try {
            rust.testsReturnJsResult(2);
            assert.fail("This function should throw");
        } catch (e) {
            helper.assertInstanceOf(e, Error);
            assert.strictEqual(e.message, "Keyspace name is empty");
            assert.strictEqual(e.name, "BadKeyspaceName");
        }
    });
    it("should get the correct error from JsResult::NapiError", function () {
        try {
            rust.testsReturnJsResult(3);
            assert.fail("This function should throw");
        } catch (e) {
            helper.assertInstanceOf(e, Error);
            assert.strictEqual(e.message, "Napi-error");
            assert.strictEqual(e.name, "Error");
        }
    });
});
