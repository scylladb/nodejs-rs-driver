"use strict";

const { assert } = require("chai");
const Client = require("../../../lib/client");
const helper = require("../../test-helper");
const { types } = require("../../../main");
const { logLevels } = types;

/**
 * Create a client with logging enabled at the given level, attach a log
 * listener that pushes events into the returned array, and connect.
 *
 * @param {string} [level] - Log level (defaults to "trace").
 * @param {function} [filter] - Optional filter for the log listener; receives
 *   (level, target, message, furtherInfo) and should return true to keep.
 * @returns {{ client: Client, events: Array }}
 */
async function createConnectedClientWithLogs(level = logLevels.trace, filter) {
    const events = [];
    const client = new Client(
        Object.assign({}, helper.baseOptions, { logLevel: level }),
    );

    client.on("log", (level, target, message, furtherInfo) => {
        const event = { level, target, message, furtherInfo };
        if (!filter || filter(level, target, message, furtherInfo)) {
            events.push(event);
        }
    });

    await client.connect();
    return { client, events };
}

describe("Client logging @SERVER_API", function () {
    this.timeout(30000);

    // Start a single-node cluster shared by all tests in this file.
    const _setup = helper.setup(1);

    describe("during connect", function () {
        it("should emit Rust driver log events when logLevel is set", async function () {
            // In this test, we assume rust will generate this specific log event.
            // But when we filter for we guarantee we get the logs from the driver, not some random other place.
            // So if at some point rust driver decides to change / rename this log below check would need to be updated.
            const { client, events } = await createConnectedClientWithLogs(
                logLevels.trace,
                (_level, target) =>
                    target && target.includes("scylla::network::connection"),
            );

            assert.isAbove(
                events.length,
                0,
                "expected at least one log event from the Rust driver during connect",
            );

            // Every Rust event must have a valid structure
            for (const event of events) {
                assert.isString(event.level);
                assert.include(
                    [
                        logLevels.trace,
                        logLevels.debug,
                        logLevels.info,
                        logLevels.warning,
                        logLevels.error,
                    ],
                    event.level,
                    `unexpected log level: ${event.level}`,
                );
                assert.isString(event.target);
                assert.isString(event.message);
            }

            await client.shutdown();
        });

        it("should still emit JS-side log events alongside Rust events", async function () {
            const { client, events } = await createConnectedClientWithLogs(
                logLevels.info,
                (_level, target) => target === "Client",
            );

            const connectLog = events.find((e) =>
                e.message.includes("Connecting to cluster"),
            );
            assert.isDefined(
                connectLog,
                "expected the JS-side 'Connecting to cluster' log event",
            );
            assert.strictEqual(connectLog.level, logLevels.info);

            await client.shutdown();
        });
    });

    describe("logging isolation across client lifecycles", function () {
        it("should disable logs for shut down client", async function () {
            const { client: firstClient, events: firstClientEvents } =
                await createConnectedClientWithLogs();

            assert.isAbove(
                firstClientEvents.length,
                0,
                "first client should have received log events during connect",
            );

            await firstClient.shutdown();
            // Allow any in-flight NonBlocking ThreadsafeFunction calls to drain
            // Repeating it will heuristically reduce chance of leaked events.
            for (let i = 0; i < 20; i++) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            // Reset received events. Any event received after this point is either
            // - leaked event
            // - event from the second client, that is received due to a bug in the shutdown logic
            // First case while acceptable, will fail this test
            // Second case is what we want to test against here.
            firstClientEvents.length = 0;

            const { client: secondClient } =
                await createConnectedClientWithLogs();

            assert.strictEqual(
                firstClientEvents.length,
                0,
                "first client should NOT receive any log events after shutdown",
            );

            await secondClient.shutdown();
        });

        it("should disable logs for finalized client", async function () {
            if (!global.gc) {
                console.warn(
                    "Test skipped: To run this test add --expose-gc flag",
                );
                return;
            }

            const firstClientEvents = [];

            let firstClient = new Client(
                Object.assign({}, helper.baseOptions, {
                    logLevel: logLevels.trace,
                }),
            );

            firstClient.on("log", (level, target, message, furtherInfo) => {
                firstClientEvents.push(level);
            });

            await firstClient.connect();

            // Release the client reference to allow GC
            // eslint-disable-next-line no-useless-assignment
            firstClient = undefined;

            for (let i = 0; i < 20; i++) {
                global.gc();
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            // Reset — any event after this point indicates a leak
            firstClientEvents.length = 0;

            const { client: secondClient } =
                await createConnectedClientWithLogs();

            assert.strictEqual(
                firstClientEvents.length,
                0,
                "first client should NOT receive any log events after being GC'd",
            );

            await secondClient.shutdown();
        });
    });
});
