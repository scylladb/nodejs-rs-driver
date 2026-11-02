"use strict";

const assert = require("assert");
const proxyquire = require("proxyquire").noCallThru();
const rust = require("../../index");

class FakeResultSet {}

const Client = proxyquire("../../lib/client", {
    "./types/result-set": FakeResultSet,
});

/**
 * Makes a client with a fake native session.
 * The session records the batch kind that each batch call gets.
 * @param {object} [queryOptions] The query options of the client.
 */
function makeClient(queryOptions) {
    const client = new Client({
        contactPoints: ["127.0.0.1"],
        logLevel: "off",
        ...(queryOptions && { queryOptions }),
    });
    const calls = [];
    client.connected = true;
    client.rustClient = {
        prepareStatement: async () => [{}, []],
        batch: async (statements, types, params, options, batchKind) => {
            calls.push({ prepared: false, batchKind });
            return {};
        },
        batchPrepared: async (handles, types, params, options, batchKind) => {
            calls.push({ prepared: true, batchKind });
            return {};
        },
    };
    return { client, calls };
}

describe("Client#batch() batch kind", function () {
    const query = "INSERT INTO ks.t (k) VALUES (1)";
    const cases = [
        ["no batch options", {}, rust.BatchKind.Logged],
        ["logged: true", { logged: true }, rust.BatchKind.Logged],
        ["logged: false", { logged: false }, rust.BatchKind.Unlogged],
        ["counter: true", { counter: true }, rust.BatchKind.Counter],
        [
            "counter: true and logged: false",
            { counter: true, logged: false },
            rust.BatchKind.Counter,
        ],
        [
            "counter: false and logged: false",
            { counter: false, logged: false },
            rust.BatchKind.Unlogged,
        ],
    ];

    for (const prepare of [false, true]) {
        describe(prepare ? "prepared" : "unprepared", function () {
            for (const [name, options, expected] of cases) {
                it(`passes kind ${expected} for ${name}`, async function () {
                    const { client, calls } = makeClient();
                    await client.batch([query], { ...options, prepare });
                    assert.deepStrictEqual(calls, [
                        { prepared: prepare, batchKind: expected },
                    ]);
                });
            }
        });
    }

    it("uses the logged option of the client", async function () {
        const { client, calls } = makeClient({ logged: false });
        await client.batch([query]);
        assert.deepStrictEqual(calls, [
            { prepared: false, batchKind: rust.BatchKind.Unlogged },
        ]);
    });

    it("prefers the logged option of the batch to the one of the client", async function () {
        const { client, calls } = makeClient({ logged: false });
        await client.batch([query], { logged: true });
        assert.deepStrictEqual(calls, [
            { prepared: false, batchKind: rust.BatchKind.Logged },
        ]);
    });
});
