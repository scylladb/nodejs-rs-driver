"use strict";

const { assert } = require("chai");
const rust = require("../../index");
require("../../lib/client");

// Counters: inline ready, inline pending, worker submissions, reserved,
// batched completions, drain callbacks, largest drain, rescheduled remainders.
describe("bounded async-bridge drains", function () {
    for (const size of [16, 300]) {
        it(`yields after an expensive conversion with ${size} outstanding futures`, async function () {
            rust.testsBridgeStats(true);
            let settledAtFirstReaction;
            const promises = Array.from({ length: size }, (_, i) =>
                // Three milliseconds exceeds both drain time budgets.
                rust.testsCasyncTrackedResult(i, 3).then((value) => {
                    settledAtFirstReaction ??= rust.testsBridgeStats(false)[4];
                    return value;
                }),
            );
            const blocked = new Int32Array(new SharedArrayBuffer(4));
            const deadline = Date.now() + 5000;
            while (rust.testsBridgePendingCompletions() !== size) {
                assert.isBelow(Date.now(), deadline, "burst did not complete");
                Atomics.wait(blocked, 0, 0, 1);
            }
            assert.deepEqual(
                await Promise.all(promises),
                Array.from({ length: size }, (_, i) => i),
            );
            assert.strictEqual(settledAtFirstReaction, 1);
            assert.strictEqual(rust.testsBridgeStats(false)[6], 1);
        });
    }

    for (const size of [128, 4096]) {
        it(`switches paths across a burst of ${size} futures`, async function () {
            rust.testsBridgeStats(true);
            const held = Array.from({ length: 8 }, () =>
                rust.testsCasyncResolveDelayed(100),
            );
            let settledAtFirstReaction;
            const burst = Array.from({ length: size }, () =>
                rust.testsCasyncResolveImmediate().then((value) => {
                    settledAtFirstReaction ??= rust.testsBridgeStats(false)[4];
                    return value;
                }),
            );
            const results = await Promise.all(burst);
            results.forEach((value) => assert.strictEqual(value, 42));
            await Promise.all(held);
            const loaded = rust.testsBridgeStats(true);
            assert.strictEqual(loaded[1], 8);
            assert.strictEqual(loaded[2], size);
            assert.strictEqual(loaded[3], 0);
            assert.strictEqual(loaded[4], size + 8);
            const limit = 1024;
            assert.isAtMost(loaded[6], limit);
            assert.isAtLeast(loaded[5], Math.ceil(size / limit));
            if (size > limit) assert.isBelow(settledAtFirstReaction, size);

            assert.strictEqual(await rust.testsCasyncSelfWake(), 42);
            const quiet = rust.testsBridgeStats(false);
            assert.strictEqual(quiet[1], 1);
            assert.strictEqual(quiet[3], 0);
            assert.strictEqual(quiet[4], 1);
            assert.strictEqual(quiet[2], 0);
        });
    }

    it("keeps mixed completions and conversion errors correct across drains", async function () {
        const held = Array.from({ length: 8 }, () =>
            rust.testsCasyncResolveDelayed(30),
        );
        const results = await Promise.allSettled(
            Array.from({ length: 1000 }, (_, i) =>
                i % 2
                    ? rust.testsCasyncThrowingConversion()
                    : rust.testsCasyncNestedPromise(),
            ),
        );
        results.forEach((result, i) => {
            if (i % 2) {
                assert.strictEqual(result.status, "rejected");
                assert.strictEqual(result.reason.message, "conversion failed");
            } else {
                assert.strictEqual(result.status, "fulfilled");
                assert.strictEqual(result.value, 42);
            }
        });
        await Promise.all(held);
    });

    it("finishes older snapshots before newly submitted completions", async function () {
        const order = [];
        let newer;
        const size = 4096;
        const older = Array.from({ length: size }, () =>
            rust.testsCasyncSelfWake().then(() => {
                order.push("older");
                newer ??= rust.testsCasyncSelfWake().then(() => {
                    order.push("newer");
                });
            }),
        );
        const blocked = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 5000;
        while (rust.testsBridgePendingCompletions() !== size) {
            assert.isBelow(Date.now(), deadline, "burst did not complete");
            Atomics.wait(blocked, 0, 0, 1);
        }
        await Promise.all(older);
        await newer;
        assert.deepEqual(order, [...Array(size).fill("older"), "newer"]);
    });
});
