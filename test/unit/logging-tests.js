"use strict";

const { assert } = require("chai");
const rust = require("../../index");
const { types } = require("../../main");
const { logLevels } = types;
const Client = require("../../lib/client");

// ---------------------------------------------------------------------------
// Because `tracing` has a single global subscriber per process, all tests
// share that subscriber.  However, `setupLogging` now registers a
// *per-client* callback and returns an id.  We register in `before` and
// unregister in `after` so each `describe` block gets a clean slate.
// ---------------------------------------------------------------------------

const allEvents = [];

/**
 * Allow any in-flight NonBlocking ThreadsafeFunction calls to drain
 * Repeating it will heuristically reduce chance of leaked events.
 */
async function drain() {
    for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
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
            await drain();

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
            await drain();

            const messages = allEvents.map((e) => e.message);
            assert.include(messages, "trace message from rust");
            assert.include(messages, "debug message from rust");
            assert.include(messages, "info message from rust");
            assert.include(messages, "warn message from rust");
            assert.include(messages, "error message from rust");
        });

        it("should deliver extra fields via furtherInfo", async function () {
            rust.testsEmitLogEvents();
            await drain();

            const furtherInfos = allEvents.map((e) => e.furtherInfo);
            assert.include(furtherInfos, 'test_field: "trace_extra"');
            assert.include(furtherInfos, 'test_field: "debug_extra"');
            assert.include(furtherInfos, 'test_field: "info_extra"');
            assert.include(furtherInfos, 'test_field: "warn_extra"');
            assert.include(furtherInfos, 'test_field: "error_extra"');
        });

        it("should set target to the Rust module path", async function () {
            rust.testsEmitLogEvents();
            await drain();

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
            await drain();

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
            await drain();

            assert.isDefined(
                removableEvents.find((e) => e.message === "before remove"),
                "should receive events before removal",
            );

            // Now remove
            rust.removeLogging(removableId);
            removableEvents.length = 0;

            rust.testsEmitLogInfo("after remove");
            await drain();

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
            await drain();

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
            await drain();

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
            await drain();

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
            await drain();

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
            await drain();

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
            await drain();

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

    describe("default log level (no logLevel set)", function () {
        async function connectAndCollectLogs(clientOptions = {}) {
            const events = [];
            // Here we create clients without existing DB, since those clients will also generate logs.
            const client = new Client(
                Object.assign({ contactPoints: ["0.0.0.0"] }, clientOptions),
            );
            client.on("log", (level, target, message, furtherInfo) => {
                events.push({ level, target, message, furtherInfo });
            });

            try {
                await client.connect();
            } catch (_) {
                // connect will fail without a real cluster — that's expected
            }

            await drain();
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
