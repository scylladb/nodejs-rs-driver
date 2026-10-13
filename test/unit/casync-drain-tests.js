"use strict";

const { assert } = require("chai");
const rust = require("../../index");
require("../../lib/client");

// Counters: inline ready, inline pending, worker submissions, reserved,
// batched completions, drain callbacks, largest drain, rescheduled remainders.
describe("bounded async-bridge drains", function () {
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
            const limit = size >= 256 ? 1024 : 64;
            assert.isAtMost(loaded[6], limit);
            assert.isAtLeast(loaded[5], Math.ceil(size / limit));
            assert.isBelow(settledAtFirstReaction, size);

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
});
