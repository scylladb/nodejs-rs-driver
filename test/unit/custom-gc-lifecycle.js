"use strict";
const { assert } = require("chai");
const asyncHooks = require("async_hooks");
const proxyquire = require("proxyquire");

// Stub for the native Rust module — allows loading lib/client without a compiled .node binary.
const rustStub = {
  removeLogging: () => { },
  setupLogging: () => 1,
  SessionWrapper: { createSession: async () => ({}) },
  "@global": true,
  "@noCallThru": true,
};

const Client = proxyquire("../../lib/client", { "../index": rustStub });

function te() {
  return Client._testExports;
}

describe("CustomGC — FinalizationRegistry lazy init and ref-count", function () {
  afterEach(function () {
    te().reset();
  });

  describe("module import", function () {
    it("should not hold a FinalizationRegistry before any connect()", function () {
      assert.isNull(te().registry);
    });

    it("should not create a CustomGC async resource on require()", function (done) {
      const gcEvents = [];
      const hook = asyncHooks.createHook({
        init(_asyncId, type) {
          if (type === "FinalizationRegistry" || /CustomGC/i.test(type)) {
            gcEvents.push(type);
          }
        },
      });
      hook.enable();
      proxyquire.noPreserveCache()("../../lib/client", { "../index": rustStub });
      setImmediate(() => {
        hook.disable();
        assert.deepEqual(gcEvents, []);
        done();
      });
    });
  });

  describe("_acquireLoggingRegistry()", function () {
    it("should create a FinalizationRegistry on the first call", function () {
      assert.instanceOf(te().acquire(), FinalizationRegistry);
    });

    it("should set the active count to 1 on the first call", function () {
      te().acquire();
      assert.strictEqual(te().count, 1);
    });

    it("should return the same instance on repeated calls", function () {
      const r1 = te().acquire();
      const r2 = te().acquire();
      assert.strictEqual(r1, r2);
      assert.strictEqual(te().count, 2);
    });
  });

  describe("_releaseLoggingRegistry()", function () {
    it("should decrement the active count", function () {
      te().acquire();
      te().acquire();
      te().release();
      assert.strictEqual(te().count, 1);
    });

    it("should null the registry when the count reaches zero", function () {
      te().acquire();
      te().release();
      assert.isNull(te().registry);
    });

    it("should not decrement below zero", function () {
      te().release();
      assert.strictEqual(te().count, 0);
      assert.isNull(te().registry);
    });

    it("should keep the registry alive while active count is above zero", function () {
      te().acquire();
      te().acquire();
      te().release();
      assert.isNotNull(te().registry);
      te().release();
      assert.isNull(te().registry);
    });
  });

  describe("FinalizationRegistry GC callback", function () {
    it("should release the ref-count when the GC callback fires", function () {
      let capturedCallback = null;
      const OrigFR = global.FinalizationRegistry;
      global.FinalizationRegistry = function (cb) {
        capturedCallback = cb;
        return new OrigFR(cb);
      };
      global.FinalizationRegistry.prototype = OrigFR.prototype;
      try {
        te().reset();
        te().acquire();
        assert.isNotNull(capturedCallback);
        capturedCallback(42);
        assert.strictEqual(te().count, 0);
        assert.isNull(te().registry);
      } finally {
        global.FinalizationRegistry = OrigFR;
      }
    });
  });

  describe("full lifecycle", function () {
    it("should create a new registry instance after the previous one was released", function () {
      const r1 = te().acquire();
      te().release();
      assert.isNull(te().registry);
      const r2 = te().acquire();
      assert.isNotNull(r2);
      assert.notStrictEqual(r1, r2);
    });
  });
});
