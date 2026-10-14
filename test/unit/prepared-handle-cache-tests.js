"use strict";

const rust = require("../../index");

const assert = require("assert");
const proxyquire = require("proxyquire").noCallThru();

class FakeResultSet {
    constructor(raw) {
        this.rows = raw.rows;
        this.rowLength = raw.rows?.length || 0;
    }
}

const Client = proxyquire("../../lib/client", {
    "./types/result-set": FakeResultSet,
});

function makeClient(maxPrepared = 512) {
    const client = new Client({
        contactPoints: ["127.0.0.1"],
        maxPrepared,
        logLevel: "off",
    });
    const prepares = [];
    const executed = [];
    const batches = [];
    client.connected = true;
    client.rustClient = {
        prepareStatement: async (query) => {
            const handle = {};
            prepares.push({ query, handle });
            // A statement that contains "?" takes one int parameter.
            const types = query.includes("?") ? [[{ baseType: 9 }, "v"]] : [];
            return [handle, types];
        },
        batchPrepared: async (handles, rows) => {
            // Copy the rows: they are a view of the client's FrameWriter buffer, which the next request reuses.
            batches.push({ handles, rows: Buffer.from(rows) });
            return { rows: [] };
        },
        executePreparedUnpaged: async (handle) => {
            executed.push(handle);
            return { rows: [] };
        },
        queryUnpaged: async () => ({ rows: [] }),
    };
    return { client, prepares, executed, batches };
}

describe("prepared statement handle cache", function () {
    it("reuses one native handle across executions", async function () {
        const { client, prepares, executed } = makeClient();
        await client.execute("SELECT * FROM t", [], {
            prepare: true,
            paged: false,
        });
        await client.execute("SELECT * FROM t", [], {
            prepare: true,
            paged: false,
        });
        assert.strictEqual(prepares.length, 1);
        assert.deepStrictEqual(executed, [
            prepares[0].handle,
            prepares[0].handle,
        ]);
    });

    const options = { prepare: true, paged: false };

    it("coalesces concurrent preparations", async function () {
        const { client, prepares, executed } = makeClient();
        await Promise.all([
            client.execute("SELECT * FROM a", [], options),
            client.execute("SELECT * FROM a", [], options),
        ]);
        assert.strictEqual(prepares.length, 1);
        assert.deepStrictEqual(executed, [
            prepares[0].handle,
            prepares[0].handle,
        ]);
    });

    it("evicts the least recently used entry", async function () {
        const { client, prepares } = makeClient(2);
        await client.execute("SELECT * FROM a", [], options);
        await client.execute("SELECT * FROM b", [], options);
        // A hit makes a the most recently used entry, so b is the next victim.
        await client.execute("SELECT * FROM a", [], options);
        await client.execute("SELECT * FROM c", [], options);
        // The cache holds at most maxPrepared entries: a and c, but not b.
        await client.execute("SELECT * FROM a", [], options);
        await client.execute("SELECT * FROM c", [], options);
        await client.execute("SELECT * FROM b", [], options);
        assert.deepStrictEqual(
            prepares.map((p) => p.query),
            [
                "SELECT * FROM a",
                "SELECT * FROM b",
                "SELECT * FROM c",
                "SELECT * FROM b",
            ],
        );
    });

    it("does not cache a failed preparation", async function () {
        const { client, prepares, executed } = makeClient();
        const prepare = client.rustClient.prepareStatement;
        let failures = 1;
        client.rustClient.prepareStatement = async (query) => {
            if (failures-- > 0) {
                throw new Error("prepare failed");
            }
            return prepare(query);
        };
        await assert.rejects(
            client.execute("SELECT * FROM t", [], options),
            /prepare failed/,
        );
        await client.execute("SELECT * FROM t", [], options);
        assert.strictEqual(prepares.length, 1);
        assert.deepStrictEqual(executed, [prepares[0].handle]);
    });

    describe("in a prepared batch", function () {
        const queryA = "INSERT INTO a (v) VALUES (?)";
        const queryB = "INSERT INTO b (v) VALUES (1)";
        const queries = [
            { query: queryA, params: [1] },
            { query: queryB, params: [] },
            { query: queryA, params: [2] },
        ];

        it("prepares each distinct statement once", async function () {
            const { client, prepares } = makeClient();
            await client.batch(queries, { prepare: true });
            assert.deepStrictEqual(
                prepares.map((p) => p.query),
                [queryA, queryB],
            );
        });

        it("keeps handles and parameter rows in statement order", async function () {
            const { client, prepares, batches } = makeClient();
            await client.batch(queries, { prepare: true });
            const [a, b] = prepares.map((p) => p.handle);
            assert.strictEqual(batches.length, 1);
            assert.deepStrictEqual(batches[0].handles, [a, b, a]);
            assert.deepStrictEqual(
                rust.testsBatchValues(batches[0].rows).map((row) => row.length),
                [1, 0, 1],
            );
        });

        it("reuses cached handles in a later batch", async function () {
            const { client, prepares, batches } = makeClient();
            await client.batch(queries, { prepare: true });
            await client.batch(queries, { prepare: true });
            assert.strictEqual(prepares.length, 2);
            assert.deepStrictEqual(batches[1].handles, batches[0].handles);
        });
    });
});
