"use strict";

const assert = require("assert");
const Client = require("../../lib/client");
const types = require("../../lib/types");
const ExecutionProfile =
    require("../../lib/execution-profile").ExecutionProfile;

describe("Client.createReusableOptions()", () => {
    function clientWithStub() {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const seen = [];
        client.rustyExecute = async (_query, _params, options) => {
            seen.push(options);
        };
        return { client, seen };
    }

    it("reuses the native wrapper with distinct request options", async () => {
        const { client, seen } = clientWithStub();
        const reusable = client.createReusableOptions({
            prepare: true,
            isIdempotent: true,
        });

        await client.execute("SELECT 1", [], reusable);
        await client.execute("SELECT 1", [], reusable);

        assert.notStrictEqual(seen[0], seen[1]);
        assert.strictEqual(seen[0].getRustOptions(), seen[1].getRustOptions());
        seen[0].setRoutingKey(Buffer.from([1]));
        seen[0].setHints(["int"]);
        seen[0].setPageState(Buffer.from([2]));
        assert.strictEqual(seen[1].getRoutingKey(), undefined);
        assert.strictEqual(seen[1].getHints(), undefined);
        assert.strictEqual(seen[1].getPageState(), undefined);
    });

    it("isolates in-place changes to request values", () => {
        const { client } = clientWithStub();
        const reusable = client.createReusableOptions({
            customPayload: { tag: Buffer.from([1]) },
            hints: [["int"]],
            pageState: Buffer.from([2]),
            routingIndexes: [0],
            routingKey: Buffer.from([3]),
            routingNames: ["id"],
            timestamp: types.Long.fromNumber(4),
        });
        const first = client.createOptions(reusable);
        const second = client.createOptions(reusable);

        first.getCustomPayload().tag[0] = 9;
        first.getHints()[0][0] = "text";
        first.getPageState()[0] = 9;
        first.getRoutingIndexes()[0] = 9;
        first.getRoutingKey()[0] = 9;
        first.getRoutingNames()[0] = "other";
        first.getTimestamp().low = 9;

        assert.deepStrictEqual(second.getCustomPayload().tag, Buffer.from([1]));
        assert.deepStrictEqual(second.getHints(), [["int"]]);
        assert.deepStrictEqual(second.getPageState(), Buffer.from([2]));
        assert.deepStrictEqual(second.getRoutingIndexes(), [0]);
        assert.deepStrictEqual(second.getRoutingKey(), Buffer.from([3]));
        assert.deepStrictEqual(second.getRoutingNames(), ["id"]);
        assert.strictEqual(second.getTimestamp().toNumber(), 4);
        assert.strictEqual(first.getRustOptions(), second.getRustOptions());
    });

    it("captures query values, defaults, and profile at creation", async () => {
        const profile = new ExecutionProfile("fast", { requestTimeout: 20 });
        const { client, seen } = clientWithStub();
        client.profileManager.getProfile = () => profile;
        const routingKey = Buffer.from([1, 2]);
        const options = { executionProfile: "fast", routingKey };
        client.options.queryOptions.prepare = true;
        const reusable = client.createReusableOptions(options);

        options.routingKey = Buffer.from([9]);
        routingKey[0] = 8;
        client.options.queryOptions.prepare = false;
        profile.requestTimeout = 30;
        await client.execute("SELECT 1", [], reusable);

        assert.strictEqual(seen[0].isPrepared(), true);
        assert.strictEqual(seen[0].getRequestTimeout(), 20);
        assert.deepStrictEqual(seen[0].getRoutingKey(), Buffer.from([1, 2]));
        const raw = seen[0].getRawQueryOptions();
        raw.routingKey[0] = 7;
        assert.deepStrictEqual(seen[0].getRoutingKey(), Buffer.from([1, 2]));
    });

    it("rejects a handle from another client", async () => {
        const first = clientWithStub().client;
        const second = clientWithStub().client;
        const reusable = first.createReusableOptions({ prepare: true });
        await assert.rejects(
            second.execute("SELECT 1", [], reusable),
            /different Client/,
        );
    });

    it("rejects unsupported inputs when creating a handle", () => {
        const { client } = clientWithStub();
        for (const options of [null, undefined, new Date()]) {
            assert.throws(
                () => client.createReusableOptions(options),
                /require a plain object/,
            );
        }
    });

    it("rejects a handle in other execution APIs", async () => {
        const { client } = clientWithStub();
        const reusable = client.createReusableOptions({ prepare: true });

        await assert.rejects(
            client.batch(["SELECT 1"], reusable),
            /supported only by execute/,
        );
        const eachRowError = await new Promise((resolve) => {
            client.eachRow("SELECT 1", [], reusable, () => {}, resolve);
        });
        assert.match(eachRowError.message, /supported only by execute/);

        const stream = client.stream("SELECT 1", [], reusable);
        const streamError = await new Promise((resolve) => {
            stream.once("error", resolve);
        });
        assert.match(streamError.message, /supported only by execute/);
    });

    it("captures mutable timestamps and client timeouts", () => {
        const { client } = clientWithStub();
        client.options.requestTimeout = 11;
        const timestamp = types.Long.fromNumber(123);
        const reusable = client.createReusableOptions({ timestamp });
        timestamp.low = 456;
        client.options.requestTimeout = 22;

        const options = client.createOptions(reusable);
        assert.strictEqual(options.getTimestamp().toNumber(), 123);
        assert.strictEqual(options.getRequestTimeout(), 11);
    });

    it("keeps ordinary query options on the regular creation path", () => {
        const { client } = clientWithStub();
        const options = { prepare: true };
        assert.notStrictEqual(
            client.createOptions(options),
            client.createOptions(options),
        );
    });
});
