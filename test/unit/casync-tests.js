"use strict";

const { assert } = require("chai");
const { Worker } = require("worker_threads");
const path = require("path");
const rust = require("../../index");
const helper = require("../test-helper");

// init_poll_bridge is called by lib/client.js at module load time.
// Require it here to ensure the bridge is ready before any test runs.
require("../../lib/client");

describe("casync bridge", function () {
    // ---------------------------------------------------------------------------
    // Resolve paths
    // ---------------------------------------------------------------------------

    describe("resolve", function () {
        it("should resolve immediately with a numeric value", async function () {
            const result = await rust.testsCasyncResolveImmediate();
            assert.strictEqual(result, 42);
        });

        it("should resolve after a delay", async function () {
            const result = await rust.testsCasyncResolveDelayed(50);
            assert.strictEqual(result, 50);
        });

        it("should resolve with a string value", async function () {
            const result = await rust.testsCasyncResolveString();
            assert.strictEqual(result, "hello from async");
        });

        it("should resolve with a boolean value", async function () {
            assert.strictEqual(await rust.testsCasyncResolveBool(true), true);
            assert.strictEqual(await rust.testsCasyncResolveBool(false), false);
        });
    });

    // ---------------------------------------------------------------------------
    // Reject paths
    // ---------------------------------------------------------------------------

    describe("reject", function () {
        it("should reject with the correct error message and name", async function () {
            try {
                await rust.testsCasyncReject();
                assert.fail("Promise should have been rejected");
            } catch (e) {
                helper.assertInstanceOf(e, Error);
                assert.strictEqual(e.message, "Keyspace name is empty");
                assert.strictEqual(e.name, "BadKeyspaceName");
            }
        });

        it("should reject with the correct error after a delay", async function () {
            try {
                await rust.testsCasyncRejectDelayed(30);
                assert.fail("Promise should have been rejected");
            } catch (e) {
                helper.assertInstanceOf(e, Error);
                assert.strictEqual(e.message, "Keyspace name is empty");
                assert.strictEqual(e.name, "BadKeyspaceName");
            }
        });

        it("should reject cleanly even when the error message contains a null byte", async function () {
            // The promise must reject (not crash) when ConvertedError::msg has \0.
            try {
                await rust.testsCasyncRejectNullByte();
                assert.fail("Promise should have been rejected");
            } catch (e) {
                helper.assertInstanceOf(e, Error);
                assert.strictEqual(e.message, "error with\0null byte");
            }
        });
    });

    // ---------------------------------------------------------------------------
    // Concurrency
    // ---------------------------------------------------------------------------

    describe("concurrency", function () {
        it("should resolve many concurrent futures", async function () {
            const N = 50;
            const results = await Promise.all(
                Array.from({ length: N }, () =>
                    rust.testsCasyncResolveImmediate(),
                ),
            );
            assert.strictEqual(results.length, N);
            results.forEach((v) => assert.strictEqual(v, 42));
        });

        it("should correctly resolve a mix of delayed and immediate futures", async function () {
            const [delayed, immediate] = await Promise.all([
                rust.testsCasyncResolveDelayed(20),
                rust.testsCasyncResolveImmediate(),
            ]);
            assert.strictEqual(delayed, 20);
            assert.strictEqual(immediate, 42);
        });

        it("should handle a mix of resolving and rejecting futures", async function () {
            const N = 20;
            const promises = Array.from({ length: N }, (_, i) =>
                i % 2 === 0
                    ? rust.testsCasyncResolveImmediate().then((v) => ({
                          ok: true,
                          value: v,
                      }))
                    : rust.testsCasyncReject().then(
                          () => assert.fail("Should not resolve"),
                          (e) => ({ ok: false, error: e }),
                      ),
            );

            const results = await Promise.all(promises);
            results.forEach((r, i) => {
                if (i % 2 === 0) {
                    assert.isTrue(r.ok);
                    assert.strictEqual(r.value, 42);
                } else {
                    assert.isFalse(r.ok);
                    assert.strictEqual(r.error.name, "BadKeyspaceName");
                }
            });
        });
    });

    // ---------------------------------------------------------------------------
    // Waker correctness
    // ---------------------------------------------------------------------------

    describe("waker", function () {
        it("should resolve exactly once even when the waker fires multiple times", async function () {
            // The future notifies twice before being polled — the coalescing
            // AtomicBool in WakerBridge must prevent double-resolution.
            const result = await rust.testsCasyncMultiWake();
            assert.strictEqual(result, 99);
        });

        it("should resolve multiple multi-wake futures concurrently", async function () {
            const results = await Promise.all([
                rust.testsCasyncMultiWake(),
                rust.testsCasyncMultiWake(),
                rust.testsCasyncMultiWake(),
            ]);
            results.forEach((v) => assert.strictEqual(v, 99));
        });
    });

    describe("environment and conversion", function () {
        it("initializes the bridge in a worker after the main thread", async function () {
            this.timeout(10000);
            const worker = new Worker(
                path.resolve(__dirname, "casync-worker.js.worker"),
            );
            try {
                const result = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(
                        () =>
                            reject(new Error("worker promise did not settle")),
                        5000,
                    );
                    worker.once("message", (value) => {
                        clearTimeout(timeout);
                        resolve(value);
                    });
                    worker.once("error", (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                    worker.once("exit", (code) => {
                        if (code !== 0) {
                            clearTimeout(timeout);
                            reject(
                                new Error(`worker exited with code ${code}`),
                            );
                        }
                    });
                });
                assert.deepEqual(result, { value: 42 });
            } finally {
                await worker.terminate();
            }
        });

        it("permits future submission during value conversion", async function () {
            assert.strictEqual(await rust.testsCasyncNestedPromise(), 42);
        });

        it("rejects a conversion exception without aborting Node", async function () {
            try {
                await rust.testsCasyncThrowingConversion();
                assert.fail("Promise should have been rejected");
            } catch (error) {
                assert.strictEqual(error.message, "conversion failed");
            }
        });

        it("rejects conversion errors with null bytes through the fallback", async function () {
            try {
                await rust.testsCasyncConversionErrorWithNullByte();
                assert.fail("Promise should have been rejected");
            } catch (error) {
                assert.strictEqual(
                    error.message,
                    "[Unknown error] Error message contained illegal null byte",
                );
            }
        });
    });
});
