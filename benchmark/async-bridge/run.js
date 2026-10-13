"use strict";

// Each invocation runs one variant in a fresh process. Native library is selected
// by NAPI_RS_NATIVE_LIBRARY_PATH; all variants use the same JS driver and workload.
const { performance, createHistogram } = require("node:perf_hooks");
const { setTimeout: sleep } = require("node:timers/promises");
const { Client } = require("../../main");
const rust = process.env.NAPI_RS_NATIVE_LIBRARY_PATH
    ? require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH)
    : require("../../index");

const scenario = process.env.SCENARIO || "sparse";
const workload = process.env.WORKLOAD || "query";
const duration = Number(process.env.DURATION || 10) * 1000;
const warmup = Number(process.env.WARMUP || 2) * 1000;
const concurrency = Number(process.env.CONCURRENCY || 128);
const rate = Number(process.env.RATE || 500);
const rows = Number(process.env.ROWS || 1);
const latency = createHistogram();
const scheduledLatency = createHistogram();
const launchLag = createHistogram();
let client;
let count = 0;
let maxPending = 0;
let pending = 0;
let errors = 0;
let measured = false;

function record(histogram, ms) {
    histogram.record(Math.max(1, Math.round(ms * 1e6)));
}

function summary(histogram) {
    return {
        p50_us: histogram.percentile(50) / 1000,
        p95_us: histogram.percentile(95) / 1000,
        p99_us: histogram.percentile(99) / 1000,
        max_us: histogram.max / 1000,
    };
}

async function main() {
    let operation;
    if (workload === "bridge") {
        operation = () => rust.testsCasyncResolveImmediate();
    } else {
        client = new Client({
            contactPoints: [process.env.BENCH_HOST || "127.0.0.1"],
            localDataCenter: "datacenter1",
        });
        await client.connect();
        await client.execute(
            "CREATE KEYSPACE IF NOT EXISTS bridge_bench WITH replication = {'class': 'NetworkTopologyStrategy', 'datacenter1': 1}",
        );
        await client.execute(
            "CREATE TABLE IF NOT EXISTS bridge_bench.reads (pk int, ck int, value text, PRIMARY KEY (pk, ck))",
        );
        // Use a fixed partition per dataset size so earlier larger-result runs
        // cannot silently change the data underneath a later comparison.
        const partitionSize = Math.max(128, rows);
        for (let i = 0; i < partitionSize; i++) {
            await client.execute(
                "INSERT INTO bridge_bench.reads (pk, ck, value) VALUES (?, ?, ?)",
                [partitionSize, i, "x".repeat(128)],
                { prepare: true },
            );
        }
        const query =
            "SELECT ck, value FROM bridge_bench.reads WHERE pk = ? LIMIT ?";
        const options = { prepare: true, fetchSize: Math.max(5000, rows) };
        operation = () => client.execute(query, [partitionSize, rows], options);
        const check = await operation();
        if (check.rows.length !== rows || check.rows[0].value.length !== 128) {
            throw new Error("Unexpected query result");
        }
    }

    async function request(planned) {
        const start = performance.now();
        const collect = measured;
        pending++;
        if (collect) maxPending = Math.max(maxPending, pending);
        try {
            const result = await operation();
            if (workload === "bridge" && result !== 42)
                throw new Error("Bad bridge value");
            if (collect) {
                const end = performance.now();
                count++;
                record(latency, end - start);
                if (planned !== undefined) {
                    record(scheduledLatency, end - planned);
                    record(launchLag, start - planned);
                }
            }
        } catch (error) {
            errors++;
            if (errors === 1) console.error(error);
        } finally {
            pending--;
        }
    }

    async function phase(ms) {
        const start = performance.now();
        const end = start + ms;
        if (scenario === "sparse") {
            // Open-loop schedule: report both service latency and latency from
            // intended arrival time, including event-loop scheduling lateness.
            const outstanding = new Set();
            for (let i = 0; ; i++) {
                const planned = start + (i * 1000) / rate;
                if (planned >= end) break;
                let delay = planned - performance.now();
                while (delay > 0) {
                    await sleep(Math.max(1, delay));
                    delay = planned - performance.now();
                }
                const promise = request(planned);
                outstanding.add(promise);
                promise.finally(() => outstanding.delete(promise));
            }
            await Promise.all(outstanding);
        } else {
            await Promise.all(
                Array.from(
                    { length: scenario === "serial" ? 1 : concurrency },
                    async () => {
                        while (performance.now() < end) await request();
                    },
                ),
            );
        }
    }

    if (process.env.BENCH_PIN_THREADS === "1") {
        console.error("BENCH_READY");
        await new Promise((resolve) => process.stdin.once("data", resolve));
        process.stdin.pause();
    }
    await phase(warmup);
    if (rust.testsBridgeStats) rust.testsBridgeStats(true);
    const cpu = process.cpuUsage();
    const elu = performance.eventLoopUtilization();
    const start = performance.now();
    measured = true;
    await phase(duration);
    const seconds = (performance.now() - start) / 1000;
    const used = process.cpuUsage(cpu);
    const result = {
        variant: process.env.VARIANT || "baseline",
        scenario,
        workload,
        rows,
        concurrency:
            scenario === "throughput"
                ? concurrency
                : scenario === "serial"
                  ? 1
                  : null,
        rate,
        count,
        errors,
        seconds,
        ops_s: count / seconds,
        cpu_cores: (used.user + used.system) / 1e6 / seconds,
        event_loop_utilization:
            performance.eventLoopUtilization(elu).utilization,
        max_pending: maxPending,
        latency: summary(latency),
        ...(scenario === "sparse"
            ? {
                  scheduled_latency: summary(scheduledLatency),
                  launch_lag: summary(launchLag),
              }
            : {}),
        ...(rust.testsBridgeStats
            ? { bridge: rust.testsBridgeStats(false) }
            : {}),
    };
    if (client) await client.shutdown();
    console.log(JSON.stringify(result));
    if (errors) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
