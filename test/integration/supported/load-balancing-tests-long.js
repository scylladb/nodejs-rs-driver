"use strict";
const assert = require("assert");
const util = require("util");

const helper = require("../../test-helper.js");
const Client = require("../../../lib/client.js");
const utils = require("../../../lib/utils.js");
const loadBalancing = require("../../../lib/policies/load-balancing.js");
const DCAwareRoundRobinPolicy = loadBalancing.DCAwareRoundRobinPolicy;
const TokenAwarePolicy = loadBalancing.TokenAwarePolicy;

describe("Datacenter-aware coordinator selection", function () {
    this.timeout(180000);

    before(helper.ccmHelper.start("2:2:2"));
    after(helper.ccmHelper.remove);

    it("should never hit remote dc with DCAwareRoundRobinPolicy", async function () {
        const options = utils.deepExtend({}, helper.baseOptions, {
            policies: {
                loadBalancing: new DCAwareRoundRobinPolicy("dc1"),
            },
        });

        await assertOnlyLocalCoordinators(options);
    });

    it("should use localDataCenter with the default policy", async function () {
        // No load-balancing policy is specified: localDataCenter must configure
        // the driver's built-in default policy.
        const options = utils.deepExtend({}, helper.baseOptions);

        await assertOnlyLocalCoordinators(options);
    });
});

async function assertOnlyLocalCoordinators(options) {
    const client = new Client(options);
    try {
        await client.connect();

        const datacenterByHost = new Map(
            client.hosts
                .values()
                .map((host) => [helper.lastOctetOf(host), host.datacenter]),
        );
        assert.deepStrictEqual(
            Array.from(new Set(datacenterByHost.values())).sort(),
            ["dc1", "dc2", "dc3"],
        );
        const localCoordinators = Array.from(datacenterByHost)
            .filter(([, datacenter]) => datacenter === "dc1")
            .map(([host]) => host)
            .sort();
        assert.strictEqual(localCoordinators.length, 2);

        const results = await Promise.all(
            Array.from({ length: 120 }, () =>
                client.execute(helper.queries.basic),
            ),
        );
        const countByHost = new Map();
        for (const result of results) {
            assert.ok(result && result.rows);
            const coordinator = helper.lastOctetOf(result.info.queriedHost);
            assert.strictEqual(
                datacenterByHost.get(coordinator),
                "dc1",
                `Expected coordinator ${result.info.queriedHost} to be in dc1`,
            );
            countByHost.set(
                coordinator,
                (countByHost.get(coordinator) || 0) + 1,
            );
        }

        assert.deepStrictEqual(
            Array.from(countByHost.keys()).sort(),
            localCoordinators,
        );
        // Hosts are shuffled rather than selected in a strict round robin. The
        // chance of either host receiving at most ten of 120 requests is negligible.
        countByHost.forEach((count) => assert.ok(count > 10));
    } finally {
        await client.shutdown();
    }
}

describe("TokenAwarePolicy", function () {
    this.timeout(120000);
    describe("with a 3:3 node topology", function () {
        const keyspace = "ks1";
        const table = "table1";
        const client = new Client({
            policies: {
                loadBalancing: new TokenAwarePolicy(
                    new DCAwareRoundRobinPolicy(),
                ),
            },
            keyspace: keyspace,
            contactPoints: helper.baseOptions.contactPoints,
        });

        before(function (done) {
            const localClient = new Client(helper.baseOptions);
            utils.series(
                [
                    helper.ccmHelper.start("3:3"),
                    localClient.connect.bind(localClient),
                    helper.toDdlTask(
                        localClient,
                        util.format(
                            "CREATE KEYSPACE %s WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1' : %d, 'dc2' : %d}",
                            keyspace,
                            1,
                            1,
                        ),
                    ),
                    helper.toDdlTask(
                        localClient,
                        util.format(
                            "CREATE TABLE %s.%s (id int primary key, name int)",
                            keyspace,
                            table,
                        ),
                    ),
                    localClient.shutdown.bind(localClient),
                ],
                done,
            );
        });
        after(function (done) {
            utils.series(
                [helper.ccmHelper.remove, client.shutdown.bind(client)],
                done,
            );
        });
        // No support for routing key
        // TODO: Fix this test
        /* it("should use primary replica according to murmur multiple dc", function (done) {
            // Pre-calculated based on Murmur
            // This test can be improved using query tracing, consistency all and checking hops
            const expectedPartition = {
                1: "2",
                2: "2",
                3: "1",
                4: "3",
                5: "2",
                6: "3",
                7: "3",
                8: "2",
                9: "1",
                10: "2",
            };
            utils.times(
                100,
                function (n, timesNext) {
                    const id = (n % 10) + 1;
                    const query = util.format(
                        "INSERT INTO %s (id, name) VALUES (%s, %s)",
                        table,
                        id,
                        id,
                    );
                    client.execute(
                        query,
                        null,
                        {
                            routingKey: utils.allocBufferFromArray([
                                0,
                                0,
                                0,
                                id,
                            ]),
                        },
                        function (err, result) {
                            assert.ifError(err);
                            // for murmur id = 1, it go to replica 2
                            const address = result.info.queriedHost;
                            assert.strictEqual(
                                helper.lastOctetOf(address),
                                expectedPartition[id.toString()],
                            );
                            timesNext();
                        },
                    );
                },
                done,
            );
        }); */
    });
    // No support for routing key
    // TODO: Fix this test
    /* describe("with a 4:4 node topology", function () {
        const keyspace1 = "ks1";
        const keyspace2 = "ks2";
        // Resolves to token -4069959284402364209 which should have primary replica of 3 and 7 with 3 being the closest replica.
        const routingKey = utils.allocBufferFromArray([0, 0, 0, 1]);

        const clientDc2 = new Client({
            policies: {
                loadBalancing: new TokenAwarePolicy(
                    new DCAwareRoundRobinPolicy(),
                ),
            },
            contactPoints: ["127.0.0.5"], // choose a host in dc2, for closest replica local selection validation.
        });
        const policyDc2 = clientDc2.options.policies.loadBalancing;

        const clientDc1 = new Client({
            policies: {
                loadBalancing: new TokenAwarePolicy(
                    new DCAwareRoundRobinPolicy(),
                ),
            },
            contactPoints: ["127.0.0.1"],
        });
        const policyDc1 = clientDc1.options.policies.loadBalancing;
        const localDc = "dc2";

        before(function (done) {
            const createQuery =
                "CREATE KEYSPACE %s WITH replication = {'class': 'NetworkTopologyStrategy', 'dc1' : %d, 'dc2' : %d}";
            /** @type {LoadBalancingPolicy} *\/
            utils.series(
                [
                    helper.ccmHelper.start("4:4"),
                    function createKs1(next) {
                        clientDc1.execute(
                            util.format(createQuery, keyspace1, 2, 2),
                            helper.waitSchema(clientDc1, next),
                        );
                    },
                    function createKs2(next) {
                        clientDc1.execute(
                            util.format(createQuery, keyspace2, 1, 1),
                            helper.waitSchema(clientDc1, next),
                        );
                    },
                    clientDc2.connect.bind(clientDc2),
                ],
                done,
            );
        });
        after(function (done) {
            utils.series(
                [
                    helper.ccmHelper.remove,
                    clientDc1.shutdown.bind(clientDc1),
                    clientDc2.shutdown.bind(clientDc2),
                ],
                done,
            );
        });

        it("should yield 2 local replicas first, then 2 remaining local nodes when RF is 2", function (done) {
            utils.times(
                20,
                function (n, timesNext) {
                    // keyspace 1
                    policyDc2.newQueryPlan(
                        keyspace1,
                        { routingKey: routingKey },
                        function (err, iterator) {
                            const hosts = helper.iteratorToArray(iterator);
                            // 2 local replicas first, 2 remaining local nodes.
                            assert.ok(hosts.length, 4);
                            hosts.forEach(function (host) {
                                assert.strictEqual(host.datacenter, localDc);
                            });
                            // the local replicas should be 7 (primary) and 8 in dc2.
                            const replicas = hosts
                                .slice(0, 2)
                                .map(helper.lastOctetOf)
                                .sort();
                            assert.deepEqual(replicas, ["7", "8"]);
                            timesNext();
                        },
                    );
                },
                done,
            );
        });
        it("should yield 1 local replica first, then 3 remaining local nodes when RF is 1", function (done) {
            utils.times(
                20,
                function (n, timesNext) {
                    // keyspace 2
                    policyDc2.newQueryPlan(
                        keyspace2,
                        { routingKey: routingKey },
                        function (err, iterator) {
                            const hosts = helper.iteratorToArray(iterator);
                            // 1 local replica, 3 remaining local nodes.
                            assert.ok(hosts.length, 4);
                            hosts.forEach(function (host) {
                                assert.strictEqual(host.datacenter, localDc);
                            });
                            // the local replicas should be 3 (primary).
                            const replicas = hosts
                                .slice(0, 1)
                                .map(helper.lastOctetOf)
                                .sort();
                            assert.deepEqual(replicas, ["7"]);
                            timesNext();
                        },
                    );
                },
                done,
            );
        });
        it("should yield closest replica first (when same DC), then 3 remaining local nodes when RF is 1", function (done) {
            utils.times(
                20,
                function (n, timesNext) {
                    //no keyspace
                    policyDc1.newQueryPlan(
                        null,
                        { routingKey: routingKey },
                        function (err, iterator) {
                            const hosts = helper.iteratorToArray(iterator);
                            //1 (closest) replica irrespective of keyspace topology, plus 3 additional local nodes
                            assert.ok(hosts.length, 4);
                            hosts.forEach(function (host) {
                                assert.strictEqual(host.datacenter, "dc1");
                            });
                            // the local replicas should be 3 (primary).
                            const replicas = hosts
                                .slice(0, 1)
                                .map(helper.lastOctetOf)
                                .sort();
                            assert.deepEqual(replicas, ["3"]);
                            timesNext();
                        },
                    );
                },
                done,
            );
        });
        it("should not yield closest replica when not in same DC as local", function (done) {
            utils.times(
                20,
                function (n, timesNext) {
                    //no keyspace
                    policyDc2.newQueryPlan(
                        null,
                        { routingKey: routingKey },
                        function (err, iterator) {
                            const hosts = helper.iteratorToArray(iterator);
                            // Should simply get all local nodes, since no keyspace was provided and the closest
                            // replica is in dc1, no token aware ordering is provided.
                            assert.ok(hosts.length, 4);
                            hosts.forEach(function (host) {
                                assert.strictEqual(host.datacenter, localDc);
                            });
                            timesNext();
                        },
                    );
                },
                done,
            );
        });
    }); */
});
