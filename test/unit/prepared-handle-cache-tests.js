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

    it("does not infer cache invalidation from query text", async function () {
        const { client, prepares, executed } = makeClient();
        const options = { prepare: true, paged: false };
        await client.execute("SELECT * FROM t", [], options);
        await client.execute("ALTER TABLE t ADD v text", [], {
            prepare: false,
            paged: false,
        });
        await client.execute("SELECT * FROM t", [], options);
        assert.strictEqual(prepares.length, 1);
        assert.strictEqual(executed[0], executed[1]);
    });

    it("keeps unrelated handles after a prepared execution fails", async function () {
        const { client, prepares } = makeClient();
        const options = { prepare: true, paged: false };
        await client.execute("SELECT * FROM a", [], options);
        await client.execute("SELECT * FROM b", [], options);

        const failedHandle = prepares[0].handle;
        client.rustClient.executePreparedHandleUnpaged = async (handle) => {
            if (handle === failedHandle) throw new Error("query failed");
            return { rows: [] };
        };

        await assert.rejects(
            client.execute("SELECT * FROM a", [], options),
            /query failed/,
        );
        await client.execute("SELECT * FROM b", [], options);
        await client.execute("SELECT * FROM a", [], options);
        assert.deepStrictEqual(
            prepares.map((p) => p.query),
            ["SELECT * FROM a", "SELECT * FROM b", "SELECT * FROM a"],
        );
    });

    it("keeps unrelated handles after a parameter encoding error", async function () {
        const { client, prepares } = makeClient();
        const options = { prepare: true, paged: false };
        await client.execute("SELECT * FROM a", [], options);
        await client.execute("SELECT * FROM b", [], options);

        await assert.rejects(
            client.execute("SELECT * FROM a", [Symbol()], options),
        );
        await client.execute("SELECT * FROM b", [], options);
        assert.deepStrictEqual(
            prepares.map((p) => p.query),
            ["SELECT * FROM a", "SELECT * FROM b", "SELECT * FROM a"],
        );
    });

    it("does not reuse a failed handle held by a concurrent caller", async function () {
        const { client, prepares } = makeClient();
        const options = client.createOptions({ prepare: true, paged: false });
        const prepared = await client.prepareStatement("SELECT * FROM a");
        client.rustClient.executePreparedHandleUnpaged = async (handle) => {
            if (handle === prepares[0].handle) throw new Error("query failed");
            return { rows: [] };
        };

        await assert.rejects(
            client.rustyExecute(prepared, [], options),
            /query failed/,
        );
        await client.rustyExecute(prepared, [], options);
        assert.strictEqual(prepares.length, 2);
    });
});
