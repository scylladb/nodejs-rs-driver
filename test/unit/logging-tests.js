"use strict";

const { assert } = require("chai");
const rust = require("../../index");
const { types } = require("../../main");
const { logLevels } = types;
const Client = require("../../lib/client");
const { Worker } = require("worker_threads");

// ---------------------------------------------------------------------------
// Because `tracing` has a single global subscriber per process, all tests
// share that subscriber.  However, `setupLogging` now registers a
// *per-client* callback and returns an id.  We register in `before` and
// unregister in `after` so each `describe` block gets a clean state.
// ---------------------------------------------------------------------------

const allEvents = [];

/**
 * Wait until the Rust log events emitted so far reach the callbacks.
 * Log events and Promise completions share one FIFO queue.
 * So when this Promise settles, the earlier log events are delivered.
 */
async function flushLogs() {
    await rust.testsCasyncResolveImmediate();
}

describe("Logging", function () {
    let loggingId;

    before(function () {
        // Register a callback at the "trace" level so we capture everything.
        loggingId = rust.setupLogging((level, target, message, furtherInfo) => {
            allEvents.push({ level, target, message, furtherInfo });
        }, logLevels.trace);
    });

    after(function () {
        rust.removeLogging(loggingId);
    });

    afterEach(function () {
        // Clear collected events between tests so assertions are isolated.
        allEvents.length = 0;
    });

    describe("testsEmitLogEvents", function () {
        it("should forward events at all five tracing levels", async function () {
            rust.testsEmitLogEvents();
            await flushLogs();

            // TRACE -> "trace", DEBUG -> "debug", INFO -> "info", WARN -> "warning", ERROR -> "error"
            const levels = allEvents.map((e) => e.level);
            assert.include(levels, logLevels.trace);
            assert.include(levels, logLevels.debug);
            assert.include(levels, logLevels.info);
            assert.include(levels, logLevels.warning);
            assert.include(levels, logLevels.error);
        });

        it("should include the correct messages", async function () {
            rust.testsEmitLogEvents();
            await flushLogs();

            const messages = allEvents.map((e) => e.message);
            assert.include(messages, "trace message from rust");
            assert.include(messages, "debug message from rust");
            assert.include(messages, "info message from rust");
            assert.include(messages, "warn message from rust");
            assert.include(messages, "error message from rust");
        });

        it("should deliver extra fields via furtherInfo", async function () {
            rust.testsEmitLogEvents();
            await flushLogs();

            const furtherInfos = allEvents.map((e) => e.furtherInfo);
            assert.include(furtherInfos, 'test_field: "trace_extra"');
            assert.include(furtherInfos, 'test_field: "debug_extra"');
            assert.include(furtherInfos, 'test_field: "info_extra"');
            assert.include(furtherInfos, 'test_field: "warn_extra"');
            assert.include(furtherInfos, 'test_field: "error_extra"');
        });

        it("should set target to the Rust module path", async function () {
            rust.testsEmitLogEvents();
            await flushLogs();

            for (const event of allEvents) {
                assert.isString(event.target);
                assert.isNotEmpty(event.target);
                // The target should contain the crate/module path
                assert.include(
                    event.target,
                    "logging_tests",
                    "target should reference the Rust module that emitted the event",
                );
            }
        });
    });

    describe("multiple callbacks (per-client)", function () {
        it("should deliver events to all registered callbacks", async function () {
            const secondEvents = [];
            const secondId = rust.setupLogging(
                (level, target, message, furtherInfo) => {
                    secondEvents.push({ level, target, message, furtherInfo });
                },
                logLevels.trace,
            );

            rust.testsEmitLogInfo("multi-callback test");
            await flushLogs();

            // Both callbacks should receive the event
            const first = allEvents.find(
                (e) => e.message === "multi-callback test",
            );
            const second = secondEvents.find(
                (e) => e.message === "multi-callback test",
            );
            assert.isDefined(first, "first callback should receive the event");
            assert.isDefined(
                second,
                "second callback should receive the event",
            );

            rust.removeLogging(secondId);
        });

        it("should stop delivering after removeLogging", async function () {
            const removableEvents = [];
            const removableId = rust.setupLogging(
                (level, target, message, furtherInfo) => {
                    removableEvents.push({
                        level,
                        target,
                        message,
                        furtherInfo,
                    });
                },
                logLevels.trace,
            );

            rust.testsEmitLogInfo("before remove");
            await flushLogs();

            assert.isDefined(
                removableEvents.find((e) => e.message === "before remove"),
                "should receive events before removal",
            );

            // Now remove
            rust.removeLogging(removableId);
            removableEvents.length = 0;

            rust.testsEmitLogInfo("after remove");
            await flushLogs();

            assert.strictEqual(
                removableEvents.length,
                0,
                "should NOT receive events after removeLogging",
            );

            // The main callback should still work
            const main = allEvents.find((e) => e.message === "after remove");
            assert.isDefined(
                main,
                "original callback should still receive events",
            );
        });
    });

    describe("level filtering", function () {
        it("should only deliver events at or above the registered level", async function () {
            const errorOnlyEvents = [];
            const errorId = rust.setupLogging(
                (level, target, message, furtherInfo) => {
                    errorOnlyEvents.push({
                        level,
                        target,
                        message,
                        furtherInfo,
                    });
                },
                logLevels.error,
            );

            rust.testsEmitLogEvents(); // emits TRACE, DEBUG, INFO, WARN, ERROR
            await flushLogs();

            // Should only have error-level events
            for (const event of errorOnlyEvents) {
                assert.strictEqual(
                    event.level,
                    logLevels.error,
                    "error-only callback should not receive non-error events",
                );
            }
            assert.isAbove(
                errorOnlyEvents.length,
                0,
                "should have received at least the ERROR event",
            );

            rust.removeLogging(errorId);
        });
    });

    describe("visitor message format", function () {
        it("should format multiple extras as comma-separated key: value pairs in furtherInfo", async function () {
            rust.testsEmitLogWithMultipleExtras();
            await flushLogs();

            const event = allEvents.find(
                (e) =>
                    e.message &&
                    e.message.includes("message with multiple extras"),
            );
            assert.isDefined(event, "should receive the event");

            assert.strictEqual(event.message, "message with multiple extras");

            assert.include(event.furtherInfo, "str_field:");
            assert.include(event.furtherInfo, "int_field:");
            assert.include(event.furtherInfo, "bool_field:");

            // Verify comma separation (3 extras = 3 parts; message is excluded)
            const parts = event.furtherInfo.split(", ");
            assert.strictEqual(
                parts.length,
                3,
                "furtherInfo should have exactly 3 comma-separated fields",
            );
        });

        it("should format string extras with debug quotes in furtherInfo", async function () {
            rust.testsEmitLogWithSingleStrExtra();
            await flushLogs();

            const event = allEvents.find(
                (e) =>
                    e.message &&
                    e.message.includes("message with single extra"),
            );
            assert.isDefined(event);
            assert.include(
                event.furtherInfo,
                '"single_value"',
                "string extras should be wrapped in debug quotes",
            );
        });

        it("should format non-string extras with debug representation in furtherInfo", async function () {
            rust.testsEmitLogWithMultipleExtras();
            await flushLogs();

            const event = allEvents.find(
                (e) =>
                    e.message &&
                    e.message.includes("message with multiple extras"),
            );
            assert.isDefined(event);

            // int_field=42 and bool_field=true are passed through record_debug
            assert.include(event.furtherInfo, "int_field: 42");
            assert.include(event.furtherInfo, "bool_field: true");
            // str_field uses record_debug too, so it has quotes
            assert.include(event.furtherInfo, 'str_field: "hello"');
        });

        it("should leave furtherInfo empty when there are no extra fields", async function () {
            rust.testsEmitLogMessageOnly();
            await flushLogs();

            const event = allEvents.find(
                (e) => e.message === "message with no extras",
            );
            assert.isDefined(event, "should receive the message-only event");
            assert.strictEqual(
                event.furtherInfo,
                "",
                "furtherInfo should be empty for a message with no extra fields",
            );
        });

        it("should map all five levels to correct JS strings", async function () {
            rust.testsEmitLogEvents();
            await flushLogs();

            const levelMap = {
                "trace message from rust": "trace",
                "debug message from rust": "debug",
                "info message from rust": "info",
                "warn message from rust": "warning",
                "error message from rust": "error",
            };

            for (const [msg, expectedLevel] of Object.entries(levelMap)) {
                const event = allEvents.find((e) => e.message === msg);
                assert.isDefined(
                    event,
                    `should find event with message "${msg}"`,
                );
                assert.strictEqual(
                    event.level,
                    expectedLevel,
                    `message "${msg}" should have level "${expectedLevel}"`,
                );
            }
        });
    });

    describe("ordering with Promise settlement", function () {
        it("should deliver a log event before the Promise of its future settles", async function () {
            const results = await Promise.all(
                Array.from({ length: 200 }, async (_, i) => {
                    const message = `ordering test ${i}`;
                    await rust.testsLogThenResolve(message);
                    // No flush: the event must already be here.
                    return allEvents.some((e) => e.message === message);
                }),
            );
            assert.isTrue(
                results.every((delivered) => delivered),
                "every log event should arrive before its Promise settles",
            );
        });

        it("should drop queued events of a callback removed before the drain", async function () {
            const removedEvents = [];
            const removedId = rust.setupLogging((level, target, message) => {
                removedEvents.push(message);
            }, logLevels.trace);

            // The event is queued, but not delivered yet.
            rust.testsEmitLogInfo("queued before remove");
            rust.removeLogging(removedId);
            await flushLogs();

            assert.deepEqual(removedEvents, []);
            assert.isDefined(
                allEvents.find((e) => e.message === "queued before remove"),
                "other callbacks should still receive the event",
            );
        });

        // A log callback can throw while a drain runs. Then the rest of
        // the drain must still work, and Node must get the original value
        // that was thrown.
        //
        // Each test puts these entries into one drain, in this order:
        // 1. A log event. Its callback throws.
        // 2. Two Promise completions.
        //
        // The test checks that:
        // - Both Promises resolve. So the exception did not stay pending
        //   and did not block the N-API calls that come after it.
        // - The `uncaughtException` listener gets the thrown value once.
        // - The listener gets the original value, not a converted copy.
        //
        // The thrown values are the ones that failed before the fix:
        // - An Error with a cyclic cause. Its conversion overflowed the
        //   stack and crashed the process.
        // - A Symbol. Its conversion to a string threw a new exception.
        //   That exception stayed pending, so the Promises did not settle.
        // A plain Error is the base case.
        describe("when a log callback throws", function () {
            let mochaListeners;
            let throwingId;

            function restoreMochaListeners() {
                if (mochaListeners !== undefined) {
                    process.removeAllListeners("uncaughtException");
                    for (const listener of mochaListeners) {
                        process.on("uncaughtException", listener);
                    }
                    mochaListeners = undefined;
                }
            }

            // Mocha does not stop an `await` after a timeout. So a Promise
            // that never settles would skip the cleanup in the test.
            // `afterEach` runs after a timeout too.
            afterEach(function () {
                restoreMochaListeners();
                if (throwingId !== undefined) {
                    rust.removeLogging(throwingId);
                    throwingId = undefined;
                }
            });

            const throwCases = [
                {
                    name: "an Error",
                    makeThrown: () => new Error("log callback error"),
                },
                {
                    name: "an Error with a cyclic cause",
                    makeThrown: () => {
                        const err = new Error("cyclic cause");
                        err.cause = err;
                        return err;
                    },
                },
                {
                    name: "a Symbol",
                    makeThrown: () => Symbol("log callback symbol"),
                },
            ];

            for (const { name, makeThrown } of throwCases) {
                it(`should settle the other Promises of a drain when the callback throws ${name}`, async function () {
                    const thrown = makeThrown();
                    throwingId = rust.setupLogging((level, target, message) => {
                        if (message === "throw in callback") {
                            throw thrown;
                        }
                    }, logLevels.trace);

                    // Mocha reports uncaught exceptions as failures.
                    // Catch the expected one here.
                    mochaListeners = process.listeners("uncaughtException");
                    process.removeAllListeners("uncaughtException");
                    const uncaught = [];
                    process.on("uncaughtException", (err) =>
                        uncaught.push(err),
                    );

                    // The log event and the completions go to one drain.
                    // The log event comes first.
                    const values = await Promise.all(
                        rust.testsLogThenResolveInOneDrain(
                            "throw in callback",
                            2,
                        ),
                    );
                    // Restore Mocha's listeners before the asserts. Else the
                    // listener above catches errors of Mocha itself.
                    restoreMochaListeners();

                    assert.deepEqual(values, [42, 42]);
                    assert.strictEqual(uncaught.length, 1);
                    // Mocha cannot print a value with a cyclic cause.
                    // So compare the identity without the values in the
                    // failure message.
                    assert.isTrue(
                        uncaught[0] === thrown,
                        "the listener should get the original thrown value",
                    );
                });
            }
        });

        it("should not deliver log events of another environment", async function () {
            const worker = new Worker(
                `
                const { parentPort } = require("worker_threads");
                const rust = require(${JSON.stringify(require.resolve("../../index"))});
                require(${JSON.stringify(require.resolve("../../lib/client"))});
                const events = [];
                const id = rust.setupLogging((level, target, message) => {
                    events.push(message);
                }, "trace");
                parentPort.on("message", async () => {
                    rust.testsEmitLogInfo("from worker");
                    await rust.testsCasyncResolveImmediate();
                    rust.removeLogging(id);
                    parentPort.postMessage(events);
                });
                parentPort.postMessage("ready");
                `,
                { eval: true },
            );
            try {
                await new Promise((resolve) => worker.once("message", resolve));
                rust.testsEmitLogInfo("from main");
                await flushLogs();
                worker.postMessage("check");
                const workerEvents = await new Promise((resolve) =>
                    worker.once("message", resolve),
                );

                assert.include(workerEvents, "from worker");
                assert.notInclude(workerEvents, "from main");
                assert.isDefined(
                    allEvents.find((e) => e.message === "from main"),
                );
                assert.isUndefined(
                    allEvents.find((e) => e.message === "from worker"),
                );
            } finally {
                await worker.terminate();
            }
        });
    });

    describe("default log level (no logLevel set)", function () {
        async function connectAndCollectLogs(clientOptions = {}) {
            const events = [];
            // Here we create clients without existing DB, since those clients will also generate logs.
            // The connection must fail, even when a local cluster listens on the default port.
            // No process can listen on port 0, so a connection to it always fails.
            const client = new Client(
                Object.assign(
                    { contactPoints: ["127.0.0.1:0"] },
                    clientOptions,
                ),
            );
            client.on("log", (level, target, message, furtherInfo) => {
                events.push({ level, target, message, furtherInfo });
            });

            try {
                await client.connect();
            } catch (_) {
                // connect will fail without a real cluster — that's expected
            }

            return { client, events };
        }

        it("should register Rust logging callback without explicit logLevel", async function () {
            const { client, events } = await connectAndCollectLogs();

            // In this test, we assume rust will generate this specific log event.
            // But when we filter for we guarantee we get the logs from the driver, not some random other place.
            // So if at some point rust driver decides to change / rename this log below check would need to be updated.
            const rustEvent = events.find(
                (e) => e.target && e.target.includes("scylla::"),
            );
            assert.isDefined(
                rustEvent,
                "Rust-initiated events should be received during connect when no logLevel is set",
            );

            await client.shutdown();
        });

        it("should receive JS-initiated log events on tracing level", async function () {
            const { client, events } = await connectAndCollectLogs({
                logLevel: logLevels.trace,
            });

            const connectLog = events.find(
                (e) =>
                    e.target === "Client" &&
                    e.message.includes("Connecting to cluster"),
            );
            assert.isDefined(
                connectLog,
                "JS-initiated log events should be received at trace level",
            );
            assert.strictEqual(connectLog.level, logLevels.info);

            await client.shutdown();
        });

        it("should NOT generate any logs when logLevel is 'off'", async function () {
            const { client, events } = await connectAndCollectLogs({
                logLevel: logLevels.off,
            });

            assert.strictEqual(
                events.length,
                0,
                "Rust events should NOT be received when logLevel is 'off'",
            );

            await client.shutdown();
        });
    });
});
