"use strict";

// Run with SCYLLA_HOST=<host> SCYLLA_DC=<datacenter> node benchmark/result-column-metadata.js.
// Compare native metadata calls, JS type conversion, and elapsed time across
// 300 one-row pages using the ResultSet async iterator.

const { performance } = require("node:perf_hooks");
const Client = require("../lib/client");
const rust = require("../index");
const resultsWrapper = require("../lib/types/results-wrapper");
const cqlUtils = require("../lib/types/cql-utils");

const keyspace = `result_column_bench_${process.pid}`;
const rowCount = 300;
const client = new Client({
    contactPoints: [process.env.SCYLLA_HOST || "127.0.0.1"],
    localDataCenter: process.env.SCYLLA_DC || "datacenter1",
    logLevel: "off",
});

const originalGetRows = resultsWrapper.getRowsFromResultsWrapper;
const originalGetNames = rust.QueryResultWrapper.prototype.getColumnsNames;
const originalGetTypes = rust.QueryResultWrapper.prototype.getColumnsTypes;
const originalCompare = rust.QueryResultWrapper.prototype.hasSameColumnsAs;
const originalGetSnapshot =
    rust.QueryResultWrapper.prototype.getColumnsSnapshot;
const originalConvert = cqlUtils.convertComplexType;

let stats;
function timeMethod(method, field) {
    return function (...args) {
        const start = performance.now();
        try {
            return method.apply(this, args);
        } finally {
            if (stats) {
                stats[field].calls++;
                stats[field].ms += performance.now() - start;
            }
        }
    };
}

rust.QueryResultWrapper.prototype.getColumnsNames = timeMethod(
    originalGetNames,
    "names",
);
rust.QueryResultWrapper.prototype.getColumnsTypes = timeMethod(
    originalGetTypes,
    "types",
);
rust.QueryResultWrapper.prototype.hasSameColumnsAs = timeMethod(
    originalCompare,
    "comparison",
);
rust.QueryResultWrapper.prototype.getColumnsSnapshot = timeMethod(
    originalGetSnapshot,
    "snapshot",
);
cqlUtils.convertComplexType = timeMethod(originalConvert, "conversion");

async function measure(mode) {
    stats = {
        names: { calls: 0, ms: 0 },
        types: { calls: 0, ms: 0 },
        comparison: { calls: 0, ms: 0 },
        snapshot: { calls: 0, ms: 0 },
        conversion: { calls: 0, ms: 0 },
    };
    resultsWrapper.getRowsFromResultsWrapper =
        mode === "without reuse"
            ? (result, encoder) => originalGetRows(result, encoder)
            : originalGetRows;

    const start = performance.now();
    const result = await client.execute(`SELECT * FROM ${keyspace}.t`, [], {
        fetchSize: 1,
        prepare: true,
    });
    let rows = 0;
    for await (const _row of result) rows++;
    console.log(
        JSON.stringify({
            mode,
            rows,
            wallMs: performance.now() - start,
            ...stats,
        }),
    );
}

async function main() {
    try {
        await client.execute(
            `CREATE KEYSPACE ${keyspace} WITH replication = {'class':'NetworkTopologyStrategy','${process.env.SCYLLA_DC || "datacenter1"}':1}`,
        );
        const columns = Array.from(
            { length: 32 },
            (_, index) => `c${index} map<text, frozen<list<text>>>`,
        ).join(", ");
        await client.execute(
            `CREATE TABLE ${keyspace}.t (id int PRIMARY KEY, ${columns})`,
        );
        for (let row = 0; row < rowCount; row++) {
            await client.execute(
                `INSERT INTO ${keyspace}.t (id) VALUES (?)`,
                [row],
                { prepare: true },
            );
        }
        for (const mode of [
            "without reuse",
            "with reuse",
            "with reuse",
            "without reuse",
        ]) {
            await measure(mode);
        }
    } finally {
        resultsWrapper.getRowsFromResultsWrapper = originalGetRows;
        cqlUtils.convertComplexType = originalConvert;
        try {
            await client.execute(`DROP KEYSPACE ${keyspace}`);
        } finally {
            await client.shutdown();
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
