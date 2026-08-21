"use strict";

// Integration test for the `clientRoutes` client option.
//
// This is only runnable against a native addon built with the `client-routes-proxy-tests`
// Cargo feature enabled (which we enable for all tests with the `build:test` script).
//
// Everything about route refreshing (reacting to CLIENT_ROUTES_CHANGE, topology changes,
// port remapping) is the rust driver's logic and is tested upstream. It is deliberately
// not retested here.

const assert = require("assert");
const http = require("http");

const helper = require("../../test-helper.js");
const Client = require("../../../lib/client.js");
const rust = require("../../../index");

// The fake NLBs this test routes through live behind the `client-routes-proxy-tests` Cargo
// feature. Skip the whole suite if the feature is not available rather than failing.
const builtForTesting =
    typeof rust.testsStartClientRoutesNlbs === "function" &&
    typeof rust.testsStopClientRoutesNlbs === "function";

const NODE_COUNT = 3;
const CONNECTION_ID = "nodejs-driver-client-routes-test";
const REST_API_PORT = 10000;
// Returns the coordinator's host id, which is how this test identifies which node
// actually served a query.
const WHOAMI_QUERY = "SELECT host_id FROM system.local WHERE key='local'";
// Used to make a route unusable on purpose.
const UNRESOLVABLE_HOSTNAME = "unreachable.invalid";

(builtForTesting ? describe : describe.skip)("Client routes", function () {
    // Generous, but bounded: posting routes retries the REST API for up to ~20s while a
    // freshly started node warms up, and each test then connects and queries every node.
    this.timeout(60000);

    helper.setup(NODE_COUNT, { initClient: false });

    let hosts;
    let nlbAddresses;
    let supported;

    before(async function () {
        // Discover every node's real address and host id over a plain connection, and
        // check whether this build even has system.client_routes.
        const discoveryClient = new Client(helper.baseOptions);
        await discoveryClient.connect();
        hosts = discoveryClient.hosts.values();
        supported = await hasClientRoutesTable(discoveryClient);

        if (!supported) {
            return;
        }

        const realAddresses = hosts.map((host) => host.addressToString());
        nlbAddresses = await rust.testsStartClientRoutesNlbs(realAddresses);
    });

    after(async function () {
        if (supported) {
            await rust.testsStopClientRoutesNlbs();
        }
    });

    beforeEach(function () {
        if (!supported) {
            this.skip();
        }
    });

    it("reaches every node through an address read from client_routes", async function () {
        // Each node's route points at its own dedicated NLB. Since the driver is given
        // no real node address other than the contact point, reaching a node at all
        // means its address came from system.client_routes and was translated by host id.
        await postClientRoutes(
            restApiIpOf(hosts),
            hosts.map((host, index) =>
                routeFor(CONNECTION_ID, host, nlbAddresses[index]),
            ),
        );

        const client = new Client({
            contactPoints: [nlbAddresses[0]],
            clientRoutes: { proxies: [{ connectionId: CONNECTION_ID }] },
            localDataCenter: helper.baseOptions.localDataCenter,
        });

        await client.connect();
        assert.strictEqual(client.hosts.length, NODE_COUNT);
        const served = await collectCoordinatorHostIds(client, NODE_COUNT);
        assert.deepStrictEqual(served, hostIdsOf(hosts));
    });

    it("uses hostnameOverride in place of the hostname from client_routes", async function () {
        const overrideConnectionId =
            "nodejs-driver-client-routes-override-test";

        // Every route's hostname is wrong on purpose, so no node is reachable unless
        // hostnameOverride replaces it.
        await postClientRoutes(
            restApiIpOf(hosts),
            hosts.map((host, index) =>
                routeFor(
                    overrideConnectionId,
                    host,
                    nlbAddresses[index],
                    UNRESOLVABLE_HOSTNAME,
                ),
            ),
        );

        const client = new Client({
            contactPoints: [nlbAddresses[0]],
            clientRoutes: {
                proxies: [
                    {
                        connectionId: overrideConnectionId,
                        // Stands in for whatever system.client_routes should have said.
                        hostnameOverride: "127.0.0.1",
                    },
                ],
            },
            localDataCenter: helper.baseOptions.localDataCenter,
        });

        await client.connect();
        const served = await collectCoordinatorHostIds(client, NODE_COUNT);
        assert.deepStrictEqual(served, hostIdsOf(hosts));
    });
});

/** The sorted host ids of the given nodes. */
function hostIdsOf(hostList) {
    return hostList.map((host) => host.hostId.toString()).sort();
}

/**
 * Queries repeatedly until every node has served at least one query, and returns the
 * sorted set of host ids that did. Relies on the load balancing policy spreading
 * queries around, so it retries rather than assuming one pass is enough.
 */
async function collectCoordinatorHostIds(client, expectedCount) {
    const seen = new Set();
    const maxAttempts = expectedCount * 50;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await client.execute(WHOAMI_QUERY);
        assert.strictEqual(result.rows.length, 1);
        seen.add(result.rows[0]["host_id"].toString());

        if (seen.size === expectedCount) {
            break;
        }
    }

    return [...seen].sort();
}

/** A `system.client_routes` row, in the REST API's schema. */
function routeFor(connectionId, host, nlbAddress, hostnameOverride) {
    const [address, port] = splitHostPort(nlbAddress);
    // Field names match Scylla's REST API schema (snake_case), not JS convention.
    /* eslint-disable camelcase */
    return {
        connection_id: connectionId,
        host_id: host.hostId.toString(),
        address: hostnameOverride !== undefined ? hostnameOverride : address,
        port: Number(port),
    };
    /* eslint-enable camelcase */
}

/** The address of a node to send REST API requests to. */
function restApiIpOf(hostList) {
    return splitHostPort(hostList[0].addressToString())[0];
}

/** Whether this ScyllaDB build has the system.client_routes table at all. */
async function hasClientRoutesTable(client) {
    const result = await client.execute(
        "SELECT table_name FROM system_schema.tables " +
            "WHERE keyspace_name = 'system' AND table_name = 'client_routes'",
    );
    if (result.rows.length > 0) {
        return true;
    }
    helper.trace(
        "system.client_routes not found - this server does not support client routes, skipping",
    );
    return false;
}

/** Splits an `ip:port` address into its two parts. */
function splitHostPort(address) {
    const separatorIndex = address.lastIndexOf(":");
    return [
        address.slice(0, separatorIndex),
        address.slice(separatorIndex + 1),
    ];
}

/**
 * POSTs the given routes to a single node's REST API. ScyllaDB propagates the
 * routes cluster-wide from there, so posting to just one node is enough - it
 * mirrors what the upstream rust driver's own client-routes tests do.
 */
function postClientRoutes(nodeIp, routes) {
    const body = JSON.stringify(routes);
    const maxAttempts = 10;
    const retryDelayMs = 2000;

    const attempt = (attemptsLeft) =>
        new Promise((resolve, reject) => {
            const req = http.request(
                {
                    host: nodeIp,
                    port: REST_API_PORT,
                    path: "/v2/client-routes",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": Buffer.byteLength(body),
                    },
                },
                (res) => {
                    let responseBody = "";
                    res.on("data", (chunk) => (responseBody += chunk));
                    res.on("end", () => {
                        if (res.statusCode === 200 || res.statusCode === 201) {
                            resolve();
                        } else {
                            reject(
                                new Error(
                                    `REST API at ${nodeIp}:${REST_API_PORT} returned ${res.statusCode}: ${responseBody}`,
                                ),
                            );
                        }
                    });
                },
            );
            req.on("error", reject);
            req.end(body);
        }).catch((err) => {
            if (attemptsLeft <= 1) {
                throw err;
            }
            return new Promise((resolve) =>
                setTimeout(resolve, retryDelayMs),
            ).then(() => attempt(attemptsLeft - 1));
        });

    return attempt(maxAttempts);
}
