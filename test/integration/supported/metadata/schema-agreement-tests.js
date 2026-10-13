"use strict";
const assert = require("chai").assert;

const helper = require("../../../test-helper");

describe("Metadata#checkSchemaAgreement()", function () {
    this.timeout(120000);

    const setupInfo = helper.setup(3);
    const client = setupInfo.client;

    it("should return true when all nodes are reachable and agree", () =>
        client.metadata.checkSchemaAgreement().then((agreement) => {
            assert.strictEqual(agreement, true);
        }));

    context("with one node stopped", function () {
        before((done) => helper.ccmHelper.stopNode(3, done));
        // Wait until the connection pool notices the node went down, so the DDL statement
        // below is coordinated by a still-up node rather than retried against the one
        // that was just stopped.
        before(() => helper.wait.forNodeDown(client, 3));

        it("should return true after a DDL statement, ignoring the stopped node", () =>
            client
                .execute(
                    "CREATE KEYSPACE ks_schema_agreement_test" +
                        " WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': 1}",
                )
                .then(() => client.metadata.checkSchemaAgreement())
                .then((agreement) => {
                    assert.strictEqual(agreement, true);
                }));

        context("and the remaining nodes stopped too", function () {
            before((done) => helper.ccmHelper.stopNode(1, done));
            before((done) => helper.ccmHelper.stopNode(2, done));

            it("should return false and log a warning when the check cannot be performed", async () => {
                const warnings = [];
                const onLog = (level, target, message) => {
                    if (level === "warning") warnings.push(message);
                };
                client.on("log", onLog);

                try {
                    const agreement =
                        await client.metadata.checkSchemaAgreement();
                    assert.strictEqual(agreement, false);
                    // Rust forwards log events asynchronously, independently of the promise result,
                    // so the warning may arrive after checkSchemaAgreement() resolves.
                    await helper.wait
                        .until(() =>
                            warnings.some((m) =>
                                m.includes("schema agreement"),
                            ),
                        )
                        .catch((err) =>
                            assert.fail(
                                `${err.message}; got: ${JSON.stringify(warnings)}`,
                            ),
                        );
                } finally {
                    client.removeListener("log", onLog);
                }
            });

            it("should resolve false rather than reject, when used with a callback", (done) => {
                client.metadata.checkSchemaAgreement((err, agreement) => {
                    assert.ifError(err);
                    assert.strictEqual(agreement, false);
                    done();
                });
            });
        });
    });
});

describe("Metadata#waitForSchemaAgreement()", function () {
    this.timeout(120000);

    const setupInfo = helper.setup(3);
    const client = setupInfo.client;

    it("should resolve when all nodes are reachable and agree", () =>
        client.metadata.waitForSchemaAgreement());

    context("with one node stopped", function () {
        before((done) => helper.ccmHelper.stopNode(3, done));
        before(() => helper.wait.forNodeDown(client, 3));

        it("should resolve after a DDL statement, ignoring the stopped node", () =>
            client
                .execute(
                    "CREATE KEYSPACE ks_wait_schema_agreement_test" +
                        " WITH replication = {'class': 'NetworkTopologyStrategy', 'replication_factor': 1}",
                )
                .then(() => client.metadata.waitForSchemaAgreement()));

        context("and the remaining nodes stopped too", function () {
            before((done) => helper.ccmHelper.stopNode(1, done));
            before((done) => helper.ccmHelper.stopNode(2, done));

            it("should reject when the check cannot be performed", () =>
                helper.assertThrowsAsync(
                    client.metadata.waitForSchemaAgreement(),
                ));

            it("should invoke the callback with an error, rather than resolving", (done) => {
                client.metadata.waitForSchemaAgreement((err) => {
                    assert.instanceOf(err, Error);
                    done();
                });
            });
        });
    });
});
