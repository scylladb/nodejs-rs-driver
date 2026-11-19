"use strict";

const assert = require("assert");
const proxyquire = require("proxyquire").noCallThru();

class FakeResultSet {
    constructor(raw) {
        this.rows = raw.rows;
        this.rowLength = raw.rows.length;
    }
}

const Client = proxyquire("../../lib/client", {
    "./types/result-set": FakeResultSet,
    "./types/results-wrapper": {
        RustResult: class {
            constructor(raw) {
                this.rows = raw.rows;
            }
            getPagingState() {
                return undefined;
            }
        },
    },
});

function makeClient(names, maxPrepared = 512) {
    const client = new Client({
        contactPoints: ["127.0.0.1"],
        maxPrepared,
        logLevel: "off",
    });
    const calls = [];
    let preparations = 0;
    client.connected = true;
    client.rustClient = {
        prepareStatement: async () => [
            { generation: ++preparations },
            names().map((name) => [{ baseType: 9 }, name]),
        ],
        executePreparedUnpaged: async (handle, types, params) => {
            calls.push({ handle, params });
            return { rows: [] };
        },
        executePreparedSinglePage: async (handle, types, params) => {
            calls.push({ handle, params });
            return { rows: [] };
        },
        batchPrepared: async (handles, types, params) => {
            calls.push({ handles, params });
            return { rows: [] };
        },
    };
    return { client, calls };
}

describe("prepared bind markers", function () {
    for (const paged of [false, true]) {
        it(`binds anonymous markers by index, paged=${paged}`, async function () {
            // Separate anonymous IN markers may even share the same name.
            const { client, calls } = makeClient(() => ["in(v)", "in(v)"]);
            await client.execute("SELECT * FROM t WHERE v IN (?, ?)", [2, 1], {
                prepare: true,
                paged,
            });
            assert.deepStrictEqual(calls[0].params, [2, 1]);
        });
    }

    it("resolves explicit names locally into marker order", async function () {
        const { client, calls } = makeClient(() => ["first", "second"]);
        await client.execute(
            "SELECT * FROM t WHERE v IN (:first, :second)",
            { second: 2, first: 1 },
            { prepare: true, paged: false },
        );
        assert.deepStrictEqual(calls[0].params, [1, 2]);
    });

    it("keeps binding positional after eviction reloads different marker names", async function () {
        let name = "IN(v)";
        const { client, calls } = makeClient(() => [name], 1);
        const query = "SELECT * FROM t WHERE v IN (?)";
        const options = { prepare: true, paged: false };
        const original = await client.prepareStatement(query);
        await client.execute(query, [1], options);
        await client.execute("SELECT * FROM another WHERE v = ?", [0], options);
        name = "new_server_name";
        await client.execute(query, [2], options);
        const refreshed = await client.prepareStatement(query);
        assert.notStrictEqual(refreshed.handle, original.handle);
        assert.deepStrictEqual(refreshed.boundParamNames, [name]);
        assert.deepStrictEqual(calls[2].params, [2]);
    });

    it("converts explicit names to positional values for prepared batches", async function () {
        const { client, calls } = makeClient(() => ["value", "key"]);
        await client.batch(
            [
                {
                    query: "UPDATE t SET v = :value WHERE k = :key",
                    params: { key: 2, value: 1 },
                },
            ],
            { prepare: true },
        );
        assert.deepStrictEqual(calls[0].params, [[1, 2]]);
    });
});
