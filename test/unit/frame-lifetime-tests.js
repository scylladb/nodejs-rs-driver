"use strict";

const rust = require("../../index");

const assert = require("assert");
const proxyquire = require("proxyquire").noCallThru();

// RustSession passes values frames to Rust as views of one shared FrameWriter buffer.
// These tests check that concurrent requests do not send each other's values.
// They use the real Client and RustSession, with mock native functions.
// The mock functions read the frame when they are called, as Rust does.
// If a frame is kept across an await, another request writes its own frame
// in the meantime, and a mock function reads the wrong values.

class FakeResultSet {
    constructor(raw) {
        this.rows = raw.rows;
        this.rowLength = raw.rows?.length || 0;
    }
}

const Encoder = require("../../lib/encoder");

/** The native functions that RustSession calls. Each test sets them. */
const native = {};
const { RustSession } = proxyquire("../../lib/rust-session", {
    "../index": new Proxy(rust, {
        get: (target, name) => native[name] ?? target[name],
    }),
});
const Client = proxyquire("../../lib/client", {
    "./types/result-set": FakeResultSet,
    "./rust-session": { RustSession },
});

/** The CQL `int` encoding of `value`, as `testsSerializedValues` shows it. */
function intHex(value) {
    const bytes = Buffer.alloc(4);
    bytes.writeInt32BE(value);
    return bytes.toString("hex");
}

/** Resolves with `value` in a later macrotask. */
const later = (value) =>
    new Promise((resolve) => setImmediate(() => resolve(value)));

/**
 * @param onPrepared When given, each prepare waits for a macrotask,
 * and then calls it, just before it returns.
 */
async function makeClient(onPrepared) {
    const client = new Client({
        contactPoints: ["127.0.0.1"],
        logLevel: "off",
    });
    // All prepares wait for one gate. Thus, the requests continue together,
    // and their steps interleave, one microtask at a time.
    let openGate;
    const gate = new Promise((resolve) => (openGate = resolve));
    const queryOf = new Map();
    // Each call: the statement and the values that the mock read from the frame.
    const calls = [];
    Object.assign(native, {
        createSession: async () => ({}),
        sessionPrepareStatement: async (session, query) => {
            await gate;
            if (onPrepared) {
                await later();
                onPrepared();
            }
            const handle = {};
            queryOf.set(handle, query);
            // Each statement takes one int parameter.
            return [handle, [[{ baseType: 9 }, "v"]]];
        },
        sessionExecutePreparedUnpaged: (session, handle, frame) => {
            calls.push({
                query: queryOf.get(handle),
                values: rust.testsSerializedValues(frame),
            });
            return later({ rows: [] });
        },
        sessionQueryUnpaged: (session, query, frame) => {
            calls.push({ query, values: rust.testsSerializedValues(frame) });
            return later({ rows: [] });
        },
        sessionBatchPrepared: (session, handles, frame) => {
            calls.push({
                query: handles.map((handle) => queryOf.get(handle)),
                values: rust.testsBatchValues(frame),
            });
            return later({ rows: [] });
        },
    });
    client.connected = true;
    client.rustClient = await RustSession.create({}, new Encoder(4, {}));
    return { client, calls, openGate };
}

/** Sorts the calls by statement, because concurrent requests can finish in any order. */
function byQuery(calls) {
    return calls
        .slice()
        .sort((a, b) => String(a.query).localeCompare(String(b.query)));
}

describe("values frames of concurrent requests", function () {
    const queries = [
        "INSERT INTO a (v) VALUES (?)",
        "INSERT INTO b (v) VALUES (?)",
    ];

    it("keep their own values in prepared statements", async function () {
        const { client, calls, openGate } = await makeClient();
        const requests = queries.map((query, i) =>
            client.execute(query, [i + 1], { prepare: true, paged: false }),
        );
        openGate();
        await Promise.all(requests);
        assert.deepStrictEqual(byQuery(calls), [
            { query: queries[0], values: [intHex(1)] },
            { query: queries[1], values: [intHex(2)] },
        ]);
    });

    it("keep their own values in unprepared statements", async function () {
        const { client, calls } = await makeClient();
        await Promise.all(
            queries.map((query, i) =>
                client.execute(query, [i + 1], {
                    prepare: false,
                    paged: false,
                    hints: ["int"],
                }),
            ),
        );
        assert.deepStrictEqual(byQuery(calls), [
            { query: queries[0], values: [intHex(1)] },
            { query: queries[1], values: [intHex(2)] },
        ]);
    });

    it("keep their own values in a prepared batch and other statements", async function () {
        const others = [];
        // Starts other requests when a prepare of the batch returns,
        // each a different number of microtasks later.
        // Thus, some of them write their frames at each step of the batch after the prepare.
        const startOthers = () => {
            for (let delay = 0; delay < 20; delay++) {
                const k = others.length;
                others.push(
                    (async () => {
                        for (let i = 0; i < delay; i++) await null;
                        await client.execute(`other ${k}`, [1000 + k], {
                            prepare: false,
                            paged: false,
                            hints: ["int"],
                        });
                    })(),
                );
            }
        };
        const { client, calls, openGate } = await makeClient(startOthers);
        const batch = client.batch(
            [
                { query: queries[0], params: [1] },
                { query: queries[1], params: [2] },
            ],
            { prepare: true },
        );
        openGate();
        await batch;
        await Promise.all(others);
        const batches = calls.filter((call) => Array.isArray(call.query));
        assert.deepStrictEqual(batches, [
            { query: queries, values: [[intHex(1)], [intHex(2)]] },
        ]);
        for (const call of calls) {
            if (Array.isArray(call.query)) continue;
            const k = Number(call.query.split(" ")[1]);
            assert.deepStrictEqual(call.values, [intHex(1000 + k)]);
        }
    });
});
