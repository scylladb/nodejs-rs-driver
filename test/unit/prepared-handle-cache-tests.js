"use strict";

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
    client.connected = true;
    client.rustClient = {
        prepareStatement: async (query) => {
            const handle = {};
            prepares.push({ query, handle });
            return [handle, []];
        },
        executePreparedHandleUnpaged: async (handle) => {
            executed.push(handle);
            return { rows: [] };
        },
        queryUnpaged: async () => ({ rows: [] }),
    };
    return { client, prepares, executed };
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

    it("coalesces concurrent preparations and evicts the oldest entry", async function () {
        const { client, prepares } = makeClient(1);
        await Promise.all([
            client.execute("SELECT * FROM a", [], {
                prepare: true,
                paged: false,
            }),
            client.execute("SELECT * FROM a", [], {
                prepare: true,
                paged: false,
            }),
        ]);
        assert.strictEqual(prepares.length, 1);
        await client.execute("SELECT * FROM b", [], {
            prepare: true,
            paged: false,
        });
        await client.execute("SELECT * FROM a", [], {
            prepare: true,
            paged: false,
        });
        assert.deepStrictEqual(
            prepares.map((p) => p.query),
            ["SELECT * FROM a", "SELECT * FROM b", "SELECT * FROM a"],
        );
    });

    it("prepares again after clearing the cache, including a retained handle", async function () {
        const { client, prepares, executed } = makeClient();
        const options = client.createOptions({ prepare: true, paged: false });
        const retained = await client.prepareStatement("SELECT * FROM a");

        await client.rustyExecute(retained, [], options);
        client.clearPreparedCache();
        await client.rustyExecute(retained, [], options);
        await client.rustyExecute("SELECT * FROM a", [], options);

        assert.strictEqual(prepares.length, 2);
        assert.deepStrictEqual(executed, [
            prepares[0].handle,
            prepares[1].handle,
            prepares[1].handle,
        ]);
    });

    it("does not restore a preparation completed after cache clearing", async function () {
        const { client, prepares } = makeClient();
        let finishFirst;
        client.rustClient.prepareStatement = (query) => {
            const handle = {};
            prepares.push({ query, handle });
            if (prepares.length === 1) {
                return new Promise((resolve) => {
                    finishFirst = () => resolve([handle, []]);
                });
            }
            return Promise.resolve([handle, []]);
        };

        const waiting = client.prepareStatement("SELECT * FROM a");
        client.clearPreparedCache();
        finishFirst();
        const refreshed = await waiting;

        assert.strictEqual(prepares.length, 2);
        assert.strictEqual(refreshed.handle, prepares[1].handle);
        assert.strictEqual(
            await client.prepareStatement("SELECT * FROM a"),
            refreshed,
        );
    });

    it("retries a preparation invalidated by clearing the cache", async function () {
        const { client, prepares } = makeClient();
        let failFirst;
        client.rustClient.prepareStatement = (query) => {
            const handle = {};
            prepares.push({ query, handle });
            if (prepares.length === 1) {
                return new Promise((_, reject) => {
                    failFirst = () =>
                        reject(new Error("old preparation failed"));
                });
            }
            return Promise.resolve([handle, []]);
        };

        const waiting = client.prepareStatement("SELECT * FROM a");
        client.clearPreparedCache();
        failFirst();

        const refreshed = await waiting;
        assert.strictEqual(prepares.length, 2);
        assert.strictEqual(refreshed.handle, prepares[1].handle);
    });
});
