"use strict";

const { assert } = require("chai");
const path = require("path");
const { Worker } = require("worker_threads");

const helper = require("../../../test-helper");

const WORKER_SCRIPT = path.resolve(
    __dirname,
    "worker-threads-worker.js.worker",
);
const STRESS_WORKER_SCRIPT = path.resolve(
    __dirname,
    "worker-threads-stress-worker.js.worker",
);

/**
 * Spawns a Worker that creates its own Client, connects to the cluster,
 * and executes a series of queries.  Returns { result, worker } so the
 * caller can ensure the worker is terminated after the test.
 *
 * Each worker creates an independent Client because objects
 * cannot be transferred across thread boundaries (only raw data).
 */
function spawnQueryWorker(workerData) {
    return spawnWorker(WORKER_SCRIPT, workerData);
}

function spawnStressWorker(workerData) {
    return spawnWorker(STRESS_WORKER_SCRIPT, workerData);
}

function spawnWorker(script, workerData) {
    const worker = new Worker(script, { workerData });

    const result = new Promise((resolve) => {
        let settled = false;

        worker.on("message", (msg) => {
            settled = true;
            resolve(msg);
        });

        worker.on("error", (err) => {
            if (!settled) {
                settled = true;
                resolve({ ok: false, error: err.message, stack: err.stack });
            }
        });

        worker.on("exit", (code) => {
            if (!settled) {
                settled = true;
                resolve({
                    ok: false,
                    error: `Worker ${workerData.workerIndex} exited with code ${code} without sending a result`,
                });
            }
        });
    });

    return { result, worker };
}

describe("Worker threads with database queries @SERVER_API", function () {
    this.timeout(6000000);

    const keyspace = helper.getRandomName("ks");
    const table = helper.getRandomName("tbl");
    const rowCount = 10;

    // Use helper.setup to start the CCM cluster and create the keyspace.
    const setupInfo = helper.setup(1, {
        keyspace,
        queries: [
            `CREATE TABLE ${table} (id uuid, worker_id int, seq int, value text, PRIMARY KEY ((worker_id), seq))`,
        ],
    });

    const workerOpts = {
        keyspace,
        table,
        contactPoints: helper.baseOptions.contactPoints,
        localDataCenter: helper.baseOptions.localDataCenter,
    };

    // Track all spawned workers so we can terminate them after each test.
    /** @type {Worker[]} */
    let activeWorkers = [];

    afterEach(async function () {
        const workers = activeWorkers;
        activeWorkers = [];
        await Promise.all(workers.map((w) => w.terminate()));
    });

    describe("Workers correctness ", function () {
        it("should execute queries from two workers", async function () {
            const s1 = spawnQueryWorker({
                ...workerOpts,
                workerIndex: 0,
                rowCount,
            });
            const s2 = spawnQueryWorker({
                ...workerOpts,
                workerIndex: 1,
                rowCount,
            });
            activeWorkers.push(s1.worker, s2.worker);

            const [r1, r2] = await Promise.all([s1.result, s2.result]);

            // Both workers must succeed.
            assert.isTrue(
                r1.ok,
                `Worker 0 failed: ${r1.error}\n${r1.stack || ""}`,
            );
            assert.isTrue(
                r2.ok,
                `Worker 1 failed: ${r2.error}\n${r2.stack || ""}`,
            );

            // Each worker should have read back exactly rowCount rows.
            assert.strictEqual(
                r1.rows.length,
                rowCount,
                "Worker 0 row count mismatch",
            );
            assert.strictEqual(
                r2.rows.length,
                rowCount,
                "Worker 1 row count mismatch",
            );

            // Verify the rows belong to the correct worker.
            for (const row of r1.rows) {
                assert.strictEqual(row.workerId, 0);
            }
            for (const row of r2.rows) {
                assert.strictEqual(row.workerId, 1);
            }
        });

        it("should verify that all worker-inserted data is visible from the main thread", async function () {
            // Workers 0 and 1 inserted rows in the first test.  Read them from
            // the main thread's client to confirm cross-thread visibility.
            const client = setupInfo.client;

            const rs0 = await client.execute(
                `SELECT * FROM ${table} WHERE worker_id = ?`,
                [0],
                { prepare: true },
            );
            const rs1 = await client.execute(
                `SELECT * FROM ${table} WHERE worker_id = ?`,
                [1],
                { prepare: true },
            );

            assert.strictEqual(
                rs0.rows.length,
                rowCount,
                "Main thread should see worker 0 rows",
            );
            assert.strictEqual(
                rs1.rows.length,
                rowCount,
                "Main thread should see worker 1 rows",
            );
        });
    });
    describe("Worker stress test for race conditions", function () {
        const numWorkers = 10;
        const queriesPerWorker = 400;
        const stressTable = helper.getRandomName("tbl_stress");

        before(function () {
            return setupInfo.client.execute(
                `CREATE TABLE ${stressTable} (worker_id int, seq int, value text, PRIMARY KEY ((worker_id), seq))`,
            );
        });

        it(`should handle ${numWorkers} workers x ${queriesPerWorker} queries without races`, async function () {
            const spawned = [];
            for (let i = 0; i < numWorkers; i++) {
                spawned.push(
                    spawnStressWorker({
                        ...workerOpts,
                        table: stressTable,
                        workerIndex: i,
                        queryCount: queriesPerWorker,
                    }),
                );
            }
            activeWorkers.push(...spawned.map((s) => s.worker));

            const results = await Promise.all(spawned.map((s) => s.result));

            for (let i = 0; i < numWorkers; i++) {
                const r = results[i];
                assert.isTrue(
                    r.ok,
                    `Worker ${i} failed: ${r.error}\n${r.stack || ""}`,
                );

                // Every insert must have succeeded.
                assert.strictEqual(
                    r.insertCount,
                    queriesPerWorker,
                    `Worker ${i}: expected ${queriesPerWorker} inserts`,
                );

                // Every concurrent read of the partition must return the
                // full set of rows that this worker inserted.
                for (let j = 0; j < r.readCounts.length; j++) {
                    assert.strictEqual(
                        r.readCounts[j],
                        queriesPerWorker,
                        `Worker ${i}, read ${j}: expected ${queriesPerWorker} rows, got ${r.readCounts[j]}`,
                    );
                }
            }
        });

        it("should have all stress-test data visible from the main thread", async function () {
            const client = setupInfo.client;

            for (let i = 0; i < numWorkers; i++) {
                const rs = await client.execute(
                    `SELECT * FROM ${stressTable} WHERE worker_id = ?`,
                    [i],
                    { prepare: true },
                );
                assert.strictEqual(
                    rs.rows.length,
                    queriesPerWorker,
                    `Main thread: worker ${i} partition should have ${queriesPerWorker} rows`,
                );
            }
        });
    });
});
