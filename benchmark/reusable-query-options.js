"use strict";

// Run from any checkout: node benchmark/reusable-query-options.js [checkout]
// The native module in each checkout must be built with the same flags.
// Set BENCH_CPU_TIME=1 to measure CPU time instead of elapsed time.
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const root = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const Client = require(path.join(root, "lib/client"));
const warmup = 20000;
const iterations = 1000000;
const cpuTime = process.env.BENCH_CPU_TIME === "1";

const scenarios = [
    [
        "same",
        () => {
            const options = { prepare: true, isIdempotent: true };
            return () => options;
        },
    ],
    ["fresh", () => () => ({ prepare: true, isIdempotent: true })],
    [
        "rotate64",
        () => (i) => ({ prepare: true, requestTimeout: (i % 64) + 1 }),
    ],
    [
        "rotate65",
        () => (i) => ({ prepare: true, requestTimeout: (i % 65) + 1 }),
    ],
];
if (Client.prototype.createReusableOptions) {
    scenarios.push([
        "reusable",
        (client) => {
            const options = client.createReusableOptions({
                prepare: true,
                isIdempotent: true,
            });
            return () => options;
        },
    ]);
}

async function measure(factory) {
    const client = new Client({ contactPoints: ["127.0.0.1"] });
    client.rustyExecute = async () => undefined;
    const options = factory(client);
    for (let i = 0; i < warmup; i++) {
        await client.execute("SELECT 1", [], options(i));
    }
    const start = cpuTime ? process.cpuUsage() : performance.now();
    for (let i = 0; i < iterations; i++) {
        await client.execute("SELECT 1", [], options(i));
    }
    let elapsedMs;
    if (cpuTime) {
        const usage = process.cpuUsage(start);
        elapsedMs = (usage.user + usage.system) / 1000;
    } else {
        elapsedMs = performance.now() - start;
    }
    return Math.round((iterations * 1000) / elapsedMs);
}

async function main() {
    const results = {};
    for (const [name, factory] of scenarios) {
        results[name] = await measure(factory);
    }
    console.log(JSON.stringify(results));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
