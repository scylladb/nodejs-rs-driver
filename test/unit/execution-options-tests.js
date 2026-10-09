"use strict";

const assert = require("assert");
const utils = require("../../lib/utils");
const types = require("../../lib/types");
const helper = require("../test-helper");
const DefaultExecutionOptions =
    require("../../lib/execution-options").DefaultExecutionOptions;
const ExecutionProfile =
    require("../../lib/execution-profile").ExecutionProfile;
const defaultOptions = require("../../lib/client-options").defaultOptions;
const Client = require("../../lib/client");

function warmCache(client, options) {
    client.createOptions(options);
    return client.createOptions(options);
}

describe("Client.createOptions()", () => {
    it("reuses options across execute calls", async () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const options = { prepare: true };
        const seen = [];
        client.rustyExecute = async (_query, _params, executionOptions) => {
            seen.push(executionOptions);
        };

        await client.execute(
            "SELECT value FROM items WHERE id = ?",
            [1],
            options,
        );
        await client.execute(
            "SELECT value FROM items WHERE id = ?",
            [2],
            options,
        );
        assert.strictEqual(seen.length, 2);
        assert.strictEqual(seen[0], seen[1]);
    });

    it("reuses execution and native options for repeated calls", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const options = { prepare: true };
        const first = warmCache(client, options);
        const second = client.createOptions(options);

        assert.strictEqual(second, first);
        assert.strictEqual(second.getRustOptions(), first.getRustOptions());
        assert.notStrictEqual(client.createOptions({ prepare: true }), first);
    });

    it("rebuilds options after a query option changes", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const options = { prepare: true, requestTimeout: 10 };
        const first = warmCache(client, options);

        options.requestTimeout = 20;
        const second = client.createOptions(options);

        assert.notStrictEqual(second, first);
        assert.notStrictEqual(second.getRustOptions(), first.getRustOptions());
        assert.strictEqual(second.getRequestTimeout(), 20);
    });

    it("rebuilds options after a routing array changes in place", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const options = { routingIndexes: [0], routingNames: ["id"] };
        const first = warmCache(client, options);

        options.routingIndexes.push(1);
        options.routingNames.push("other");
        const second = client.createOptions(options);

        assert.notStrictEqual(second.getRustOptions(), first.getRustOptions());
        assert.deepStrictEqual(second.getRoutingIndexes(), [0, 1]);
    });

    it("does not cache accessor or inherited options", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        let timeout = 10;
        const accessorOptions = {
            get requestTimeout() {
                return timeout;
            },
        };
        const first = warmCache(client, accessorOptions);
        timeout = 20;
        assert.notStrictEqual(client.createOptions(accessorOptions), first);

        const inheritedOptions = Object.create({ requestTimeout: 10 });
        const inheritedFirst = warmCache(client, inheritedOptions);
        Object.getPrototypeOf(inheritedOptions).requestTimeout = 20;
        assert.notStrictEqual(
            client.createOptions(inheritedOptions),
            inheritedFirst,
        );
    });

    it("rebuilds after client defaults or profile settings change", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const options = { prepare: true };
        const first = warmCache(client, options);

        client.options.queryOptions.fetchSize = 100;
        const second = client.createOptions(options);
        assert.notStrictEqual(second, first);

        client.profileManager.getProfile().consistency =
            types.consistencies.localQuorum;
        const third = client.createOptions(options);
        assert.notStrictEqual(third, second);

        client.options.requestTimeout = 100;
        assert.notStrictEqual(client.createOptions(options), third);
    });

    it("rebuilds after a Long timestamp changes in place", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const timestamp = types.Long.fromNumber(10);
        const options = { timestamp };
        const first = warmCache(client, options);

        timestamp.low = 20;
        const second = client.createOptions(options);

        assert.notStrictEqual(second.getRustOptions(), first.getRustOptions());
        assert.strictEqual(second.getTimestamp().toNumber(), 20);
    });

    it("does not cache a profile with inherited settings", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const baseProfile = new ExecutionProfile("base", { consistency: 1 });
        const profile = Object.create(baseProfile);
        const options = { executionProfile: profile };
        const first = warmCache(client, options);

        baseProfile.consistency = 2;
        const second = client.createOptions(options);

        assert.notStrictEqual(second.getRustOptions(), first.getRustOptions());
        assert.strictEqual(second.getConsistency(), 2);
    });

    it("validates changed options after a cache hit", () => {
        const client = new Client({ contactPoints: ["127.0.0.1"] });
        const options = { requestTimeout: 10 };
        client.createOptions(options);
        client.createOptions(options);

        options.requestTimeout = -1;
        assert.throws(() => client.createOptions(options), /requestTimeout/);

        delete options.requestTimeout;
        options.executionProfile = "missing";
        assert.throws(() => client.createOptions(options), /not found/);
        assert.throws(() => client.createOptions(options), /not found/);
    });

    it("does not share cached options across clients", () => {
        const options = { prepare: true };
        const first = new Client({
            contactPoints: ["127.0.0.1"],
            requestTimeout: 10,
        });
        const second = new Client({
            contactPoints: ["127.0.0.1"],
            requestTimeout: 20,
        });

        const firstOptions = warmCache(first, options);
        const secondOptions = warmCache(second, options);

        assert.notStrictEqual(
            firstOptions.getRustOptions(),
            secondOptions.getRustOptions(),
        );
        assert.strictEqual(firstOptions.getRequestTimeout(), 10);
        assert.strictEqual(secondOptions.getRequestTimeout(), 20);
    });
});

describe("DefaultExecutionOptions", () => {
    describe("create()", () => {
        it("should get the values from the query options", () => {
            const options = {
                autoPage: true,
                captureStackTrace: true,
                consistency: 2,
                counter: true,
                customPayload: {},
                executionProfile: "oltp",
                fetchSize: 30,
                hints: ["int"],
                isIdempotent: true,
                keyspace: "ks2",
                logged: true,
                pageState: utils.allocBufferFromArray([1, 2, 3, 4]),
                prepare: true,
                requestTimeout: 123,
                retry: {},
                routingNames: ["a"],
                routingIndexes: [1, 2],
                routingKey: utils.allocBufferFromArray([0, 1]),
                serialConsistency: 10,
                traceQuery: true,
            };

            // Execution profile options should not be used
            const executionProfile = new ExecutionProfile("a", {
                consistency: 100,
                serialConsistency: 200,
                retry: {},
                requestTimeout: 1000,
            });

            const execOptions = DefaultExecutionOptions.create(
                options,
                getClientFake(executionProfile),
            );

            assertExecutionOptions(execOptions, options);
        });

        it("should default some values from the execution profile", () => {
            const options = {
                autoPage: false,
                captureStackTrace: false,
                counter: false,
                customPayload: {},
                executionProfile: "oltp2",
                fetchSize: 30,
                hints: ["int"],
                isIdempotent: false,
                keyspace: "ks3",
                logged: false,
                pageState: utils.allocBufferFromArray([1, 2, 3, 4]),
                prepare: false,
                routingNames: ["ab"],
                routingIndexes: [1, 2],
                routingKey: utils.allocBufferFromArray([0, 1]),
                traceQuery: true,
            };

            // The following execution profile options should be used
            const executionProfile = new ExecutionProfile("a", {
                consistency: 1,
                serialConsistency: 2,
                retry: {},
                requestTimeout: 3,
                loadBalancing: {},
            });

            const execOptions = DefaultExecutionOptions.create(
                options,
                getClientFake(executionProfile),
            );

            assertExecutionOptions(execOptions, options);
            assertExecutionOptions(execOptions, executionProfile);
        });

        it("should default some values from the client options", () => {
            const options = {
                autoPage: false,
                executionProfile: "oltp2",
                hints: ["text"],
                keyspace: "ks4",
                logged: true,
                pageState: utils.allocBufferFromArray([1, 2, 3, 4, 5]),
                traceQuery: true,
            };

            const clientOptions = defaultOptions();

            clientOptions.queryOptions = {
                captureStackTrace: false,
                consistency: 4,
                customPayload: {},
                fetchSize: 50,
                isIdempotent: false,
                prepare: true,
                serialConsistency: 5,
                traceQuery: true,
            };
            clientOptions.requestTimeout = 3456;
            clientOptions.policies.retry = {};

            const execOptions = DefaultExecutionOptions.create(
                options,
                getClientFake(null, clientOptions),
            );

            assertExecutionOptions(execOptions, options);
            assertExecutionOptions(execOptions, clientOptions.queryOptions);
            assert.strictEqual(
                execOptions.getRequestTimeout(),
                clientOptions.requestTimeout,
            );
            assert.strictEqual(
                execOptions.getRetryPolicy(),
                clientOptions.policies.retry,
            );
        });

        it("should preserve request timeout precedence when a higher-priority value is zero", () => {
            const clientOptions = defaultOptions();
            clientOptions.requestTimeout = 3456;

            const queryOverride = DefaultExecutionOptions.create(
                { requestTimeout: 0 },
                getClientFake(
                    new ExecutionProfile("query-zero", {
                        requestTimeout: 1000,
                    }),
                    clientOptions,
                ),
            );
            assert.strictEqual(queryOverride.getRequestTimeout(), 0);

            const profileOverride = DefaultExecutionOptions.create(
                {},
                getClientFake(
                    new ExecutionProfile("profile-zero", { requestTimeout: 0 }),
                    clientOptions,
                ),
            );
            assert.strictEqual(profileOverride.getRequestTimeout(), 0);
        });

        it("should retain the legacy read timeout getter without applying it", () => {
            const clientOptions = defaultOptions();
            const execOptions = DefaultExecutionOptions.create(
                { requestTimeout: 25 },
                getClientFake(null, clientOptions),
            );

            assert.strictEqual(
                execOptions.getReadTimeout(),
                clientOptions.socketOptions.readTimeout,
            );
            assert.strictEqual(execOptions.getRequestTimeout(), 25);
        });

        it("should reject invalid query request timeouts", () => {
            [-1, 1.5, NaN, Infinity, 0x80000000, "100"].forEach(
                (requestTimeout) => {
                    assert.throws(
                        () =>
                            DefaultExecutionOptions.create(
                                { requestTimeout },
                                getClientFake(),
                            ),
                        /QueryOptions\.requestTimeout must be an integer between 0 and 2147483647/,
                    );
                },
            );
        });

        it("rejects legacy query readTimeout", () => {
            assert.throws(
                () =>
                    DefaultExecutionOptions.create(
                        { readTimeout: 1000 },
                        getClientFake(),
                    ),
                /QueryOptions\.readTimeout is unsupported; use requestTimeout instead/,
            );
        });

        it("should allow null, undefined or function queryOptions argument", () => {
            const executionProfile = new ExecutionProfile("a", {
                consistency: 1,
                serialConsistency: 2,
                retry: {},
                requestTimeout: 3,
                loadBalancing: {},
            });

            [null, undefined, () => {}].forEach((options) => {
                const execOptions = DefaultExecutionOptions.create(
                    options,
                    getClientFake(executionProfile),
                );
                assertExecutionOptions(execOptions, executionProfile);
            });
        });

        it("should convert hex pageState to Buffer", () => {
            const options = { pageState: "abcd" };
            const execOptions = DefaultExecutionOptions.create(
                options,
                getClientFake(),
            );
            assert.deepStrictEqual(
                execOptions.getPageState(),
                utils.allocBufferFromString(options.pageState, "hex"),
            );
        });

        it("should expose the raw query options or an empty object", () => {
            [
                undefined,
                null,
                () => {},
                { prepare: true, myCustomOption: 1 },
            ].forEach((options) => {
                const execOptions = DefaultExecutionOptions.create(
                    options,
                    getClientFake(),
                );

                const expectedOptions =
                    options && typeof options !== "function"
                        ? options
                        : utils.emptyObject;
                assert.strictEqual(
                    execOptions.getRawQueryOptions(),
                    expectedOptions,
                );
            });
        });
    });

    describe("#getOrCreateTimestamp()", () => {
        it("should use the provided timestamp value", () => {
            const options = { timestamp: types.Long.fromNumber(10) };
            const execOptions = DefaultExecutionOptions.create(
                options,
                getClientFake(),
            );
            assert.strictEqual(
                execOptions.getOrGenerateTimestamp(),
                options.timestamp,
            );
        });

        it("should convert from Number to Long", () => {
            const options = { timestamp: 5 };
            const execOptions = DefaultExecutionOptions.create(
                options,
                getClientFake(),
            );
            const value = execOptions.getOrGenerateTimestamp();
            helper.assertInstanceOf(value, types.Long);
            assert.ok(value.equals(options.timestamp));
        });

        it("should use the timestamp generator when no value is provided", () => {
            const clientOptions = defaultOptions();

            this.called = 0;
            clientOptions.policies.timestampGeneration.next = () =>
                ++this.called;

            const execOptions = DefaultExecutionOptions.create(
                {},
                getClientFake(null, clientOptions),
            );
            const value = execOptions.getOrGenerateTimestamp();
            helper.assertInstanceOf(value, types.Long);
            assert.ok(value.equals(types.Long.ONE));
            assert.strictEqual(this.called, 1);
        });
    });
});

describe("Client#batch()", () => {
    it("should validate query request timeout before connecting", async () => {
        const client = new Client(helper.baseOptions);
        client.isShuttingDown = true;

        await assert.rejects(
            client.batch(["SELECT key FROM system.local"], {
                requestTimeout: -1,
            }),
            (err) => {
                assert.ok(err instanceof TypeError);
                assert.match(
                    err.message,
                    /QueryOptions\.requestTimeout must be an integer between 0 and 2147483647/,
                );
                return true;
            },
        );
    });
});

/**
 * @param {ExecutionOptions} execOptions
 * @param expectedOptions
 */
function assertExecutionOptions(execOptions, expectedOptions) {
    const propToMethod = new Map([
        ["traceQuery", "isQueryTracing"],
        ["retry", "getRetryPolicy"],
        ["autoPage", "isAutoPage"],
        ["counter", "isBatchCounter"],
        ["logged", "isBatchLogged"],
        ["prepare", "isPrepared"],
        ["loadBalancing", "getLoadBalancingPolicy"],
    ]);

    const ignoreProps = new Set([
        "executionProfile",
        "name",
        "graphOptions",
        "readTimeout",
    ]);

    Object.keys(expectedOptions).forEach((prop) => {
        if (ignoreProps.has(prop)) {
            return;
        }

        let methodName = propToMethod.get(prop);

        if (!methodName) {
            if (prop.indexOf("is") === 0) {
                methodName = prop;
            } else {
                methodName = `get${prop.substr(0, 1).toUpperCase()}${prop.substr(1)}`;
            }
        }

        const method = execOptions[methodName];
        if (typeof method !== "function") {
            throw new Error(`No method "${methodName}" found`);
        }

        assert.strictEqual(expectedOptions[prop], method.call(execOptions));
    });
}

function getClientFake(executionProfile, clientOptions) {
    return {
        profileManager: {
            getProfile: (x) =>
                executionProfile || new ExecutionProfile(x || "default"),
        },
        options: clientOptions || defaultOptions(),
        controlConnection: { protocolVersion: 4 },
    };
}
