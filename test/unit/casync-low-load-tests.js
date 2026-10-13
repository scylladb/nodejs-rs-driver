"use strict";

const { assert } = require("chai");
const rust = require("../../index");
require("../../lib/client");

// Counters: inline ready, inline pending, worker submissions, reserved,
// batched completions, drain callbacks, largest drain, reserved.
describe("low-load async bridge", function () {
    it("settles ready low-load futures without a worker or completion callback", async function () {
        rust.testsBridgeStats(true);
        const promise = rust.testsCasyncResolveImmediate();
        let reacted = false;
        promise.then(() => {
            reacted = true;
        });
        assert.isFalse(reacted, "Promise reactions must remain asynchronous");
        assert.strictEqual(await promise, 42);
        const stats = rust.testsBridgeStats(false);
        assert.strictEqual(stats[0], 1);
        assert.strictEqual(stats[1] + stats[2] + stats[3] + stats[4], 0);
    });

    it("queues completion after a low-load first poll wakes itself", async function () {
        rust.testsBridgeStats(true);
        assert.strictEqual(await rust.testsCasyncSelfWake(), 42);
        const stats = rust.testsBridgeStats(false);
        assert.strictEqual(stats[1], 1);
        assert.strictEqual(stats[3], 0);
        assert.strictEqual(stats[4], 1);
    });

    it("coalesces a completed low-load burst into one drain", async function () {
        rust.testsBridgeStats(true);
        const promises = Array.from({ length: 8 }, () =>
            rust.testsCasyncSelfWake(),
        );
        // Keep JS from draining while Tokio completes the whole burst.
        const blocked = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 5000;
        while (rust.testsBridgePendingCompletions() !== 8) {
            assert.isBelow(Date.now(), deadline, "burst did not complete");
            Atomics.wait(blocked, 0, 0, 1);
        }
        assert.deepEqual(await Promise.all(promises), Array(8).fill(42));
        const stats = rust.testsBridgeStats(false);
        assert.strictEqual(stats[4], 8);
        assert.strictEqual(stats[5], 1);
        assert.strictEqual(stats[6], 8);
    });

    it("uses the queue under load and returns to inline polling afterward", async function () {
        rust.testsBridgeStats(true);
        const held = Array.from({ length: 8 }, () =>
            rust.testsCasyncResolveDelayed(100),
        );
        const values = await Promise.all(
            Array.from({ length: 128 }, () =>
                rust.testsCasyncResolveImmediate(),
            ),
        );
        values.forEach((value) => assert.strictEqual(value, 42));
        await Promise.all(held);
        const loaded = rust.testsBridgeStats(true);
        assert.strictEqual(loaded[1], 8);
        assert.strictEqual(loaded[2], 128);
        assert.strictEqual(loaded[3], 0);
        assert.strictEqual(loaded[4], 136);

        assert.strictEqual(await rust.testsCasyncSelfWake(), 42);
        const quiet = rust.testsBridgeStats(false);
        assert.strictEqual(quiet[1], 1);
        assert.strictEqual(quiet[3], 0);
        assert.strictEqual(quiet[2], 0);
        assert.strictEqual(quiet[4], 1);
    });
});
