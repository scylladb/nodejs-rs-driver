"use strict";

// Run against two built checkouts to compare paging before and after #599.
// Example: DRIVER_ROOT=. CONTACT_POINT=127.0.0.1 node benchmark/each-row-paging.js

const path = require("node:path");
const { performance } = require("node:perf_hooks");

const driverRoot = path.resolve(process.env.DRIVER_ROOT || ".");
const { Client } = require(path.join(driverRoot, "main.js"));
const contactPoint = process.env.CONTACT_POINT || "127.0.0.1";
const localDataCenter = process.env.LOCAL_DATA_CENTER;
const rows = Number(process.env.ROWS || 500);
const warmups = Number(process.env.WARMUPS || 5);
const runs = Number(process.env.RUNS || 30);
const fetchSize = Number(process.env.FETCH_SIZE || 10);
const keyspace = `bench_each_row_${process.pid}_${Date.now()}`;
const partition = "p".repeat(4096);

for (const [name, value] of Object.entries({
    rows,
    warmups,
    runs,
    fetchSize,
})) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`${name} must be a positive integer`);
    }
}
if (fetchSize >= rows) {
    throw new Error("FETCH_SIZE must be smaller than ROWS to exercise paging");
}

const client = new Client({
    contactPoints: [contactPoint],
    ...(localDataCenter ? { localDataCenter } : {}),
    logLevel: "off",
});

function eachRow(prepare) {
    return new Promise((resolve, reject) => {
        let count = 0;
        client.eachRow(
            `SELECT id, value FROM ${keyspace}.data WHERE partition = ?`,
            [partition],
            { prepare, autoPage: true, fetchSize },
            () => count++,
            (error) => (error ? reject(error) : resolve(count)),
        );
    });
}

async function measure(prepare) {
    for (let i = 0; i < warmups; i++) {
        if ((await eachRow(prepare)) !== rows)
            throw new Error("Wrong warmup row count");
    }
    const samples = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        const count = await eachRow(prepare);
        samples.push(performance.now() - start);
        if (count !== rows)
            throw new Error(`Expected ${rows} rows, got ${count}`);
    }
    samples.sort((a, b) => a - b);
    const total = samples.reduce((sum, sample) => sum + sample, 0);
    return {
        prepare,
        meanMs: total / runs,
        medianMs: samples[Math.floor(runs / 2)],
        p95Ms: samples[Math.ceil(runs * 0.95) - 1],
        rowsPerSecond: (runs * rows * 1000) / total,
    };
}

async function main() {
    let created = false;
    try {
        await client.connect();
        await client.execute(
            `CREATE KEYSPACE ${keyspace} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND tablets = {'enabled': false}`,
        );
        created = true;
        await client.execute(
            `CREATE TABLE ${keyspace}.data (partition text, id int, value text, PRIMARY KEY (partition, id))`,
        );
        const insert = `INSERT INTO ${keyspace}.data (partition, id, value) VALUES (?, ?, ?)`;
        for (let i = 0; i < rows; i++) {
            await client.execute(insert, [partition, i, "v"], {
                prepare: true,
            });
        }
        console.log(
            JSON.stringify({
                driverRoot,
                contactPoint,
                rows,
                fetchSize,
                warmups,
                runs,
                results: [await measure(true), await measure(false)],
            }),
        );
    } finally {
        if (created) await client.execute(`DROP KEYSPACE ${keyspace}`);
        await client.shutdown();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
