"use strict";

const assert = require("assert");
const proxyquire = require("proxyquire").noCallThru();

class FakeResultSet {
    static created = [];

    constructor(rawResult, _encoder, pagingState, decodedColumns) {
        this.rows = rawResult.rows;
        this.rowLength = this.rows.length;
        this.innerPageState = pagingState || undefined;
        this.rawPageState = pagingState?.getRawPageState();
        this.decodedColumns = decodedColumns;
        FakeResultSet.created.push(this);
    }
}

const Client = proxyquire("../../lib/client", {
    "./types/result-set": FakeResultSet,
});

function makeClient() {
    FakeResultSet.created = [];
    const client = new Client({
        contactPoints: ["127.0.0.1"],
        logLevel: "off",
    });
    client.connected = true;
    let executions = 0;
    let fetches = 0;
    const states = [Buffer.from([1]), Buffer.from([2])];

    client.rustyExecute = async (
        _query,
        _params,
        _options,
        _state,
        decodedColumns,
    ) => {
        executions++;
        const first = new FakeResultSet(
            { rows: [{ page: 1 }] },
            null,
            {
                getRawPageState: () => states[0],
            },
            decodedColumns,
        );
        first.rawNextPageAsync = async (state) => {
            assert.deepStrictEqual(state, states[fetches]);
            fetches++;
            return fetches % 2 === 1
                ? [
                      { getRawPageState: () => states[1] },
                      { rows: [{ page: 2 }] },
                  ]
                : [null, { rows: [{ page: 3 }] }];
        };
        return first;
    };

    return {
        client,
        counts: () => ({ executions, fetches }),
    };
}

describe("eachRow paging", function () {
    it("uses the native executor for later automatic pages", async function () {
        const { client, counts } = makeClient();
        const rows = [];

        const result = await new Promise((resolve, reject) => {
            client.eachRow(
                "SELECT * FROM t",
                [],
                { prepare: true, autoPage: true },
                (_index, row) => rows.push(row.page),
                (err, result) => (err ? reject(err) : resolve(result)),
            );
        });

        assert.deepStrictEqual(rows, [1, 2, 3]);
        assert.strictEqual(result.rowLength, 3);
        assert.strictEqual(result.nextPage, undefined);
        assert.deepStrictEqual(result.rows, [{ page: 3 }]);
        assert.deepStrictEqual(counts(), { executions: 1, fetches: 2 });
        const pageCaches = FakeResultSet.created.map(
            (page) => page.decodedColumns,
        );
        assert.strictEqual(pageCaches.length, 3);
        assert.ok(pageCaches[0]);
        assert.ok(pageCaches.every((cache) => cache === pageCaches[0]));
    });

    it("uses the native executor for manual nextPage calls", async function () {
        const { client, counts } = makeClient();
        const rows = [];
        const results = [];

        await new Promise((resolve, reject) => {
            client.eachRow(
                "SELECT * FROM t",
                [],
                { prepare: false, autoPage: false },
                (_index, row) => rows.push(row.page),
                (err, result) => {
                    if (err) return reject(err);
                    results.push(result);
                    if (result.nextPage) return result.nextPage();
                    resolve();
                },
            );
        });

        assert.deepStrictEqual(rows, [1, 2, 3]);
        assert.deepStrictEqual(
            results.map((result) => result.rowLength),
            [1, 2, 3],
        );
        assert.deepStrictEqual(counts(), { executions: 1, fetches: 2 });
    });

    it("passes a later-page failure to the completion callback", async function () {
        const { client, counts } = makeClient();
        const rows = [];
        let completions = 0;
        const execute = client.rustyExecute;
        client.rustyExecute = async (...args) => {
            const result = await execute(...args);
            result.rawNextPageAsync = async () => {
                throw new Error("page failed");
            };
            return result;
        };

        await assert.rejects(
            new Promise((resolve, reject) => {
                client.eachRow(
                    "SELECT * FROM t",
                    [],
                    { prepare: true, autoPage: true },
                    (_index, row) => rows.push(row.page),
                    (err) => {
                        completions++;
                        return err ? reject(err) : resolve();
                    },
                );
            }),
            /page failed/,
        );
        assert.deepStrictEqual(rows, [1]);
        assert.strictEqual(completions, 1);
        assert.strictEqual(counts().executions, 1);
    });

    it("rejects a manual nextPage after shutdown", async function () {
        const { client, counts } = makeClient();
        const rows = [];
        let rejectNextPage;
        const nextPageError = new Promise((_, reject) => {
            rejectNextPage = reject;
        });
        let receivedFirstPage = false;

        const firstPage = await new Promise((resolve, reject) => {
            client.eachRow(
                "SELECT * FROM t",
                [],
                { autoPage: false },
                (_index, row) => rows.push(row.page),
                (err, result) => {
                    if (err) {
                        return receivedFirstPage
                            ? rejectNextPage(err)
                            : reject(err);
                    }
                    receivedFirstPage = true;
                    resolve(result);
                },
            );
        });

        await client.shutdown();
        firstPage.nextPage();
        await assert.rejects(
            nextPageError,
            /Connecting after shutdown is not supported/,
        );
        assert.deepStrictEqual(rows, [1]);
        assert.deepStrictEqual(counts(), { executions: 1, fetches: 0 });
    });
});
