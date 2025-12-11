"use strict";
const assert = require("assert");
const util = require("util");

const helper = require("../../test-helper");
const Client = require("../../../lib/client");
const utils = require("../../../lib/utils");
const types = require("../../../lib/types");

describe("Client @SERVER_API", function () {
    this.timeout(60000);
    context("with ssl enabled", function () {
        const keyspace = helper.getRandomName("ks");
        const table = keyspace + "." + helper.getRandomName("table");
        const setupQueries = [
            helper.createKeyspaceCql(keyspace, 1),
            helper.createTableCql(table),
        ];
        before(helper.ccmHelper.start(1, { ssl: true }));
        before(helper.executeTask(newInstance(), setupQueries));
        after(helper.ccmHelper.remove);
        describe("#connect()", function () {
            it("should connect to a ssl enabled cluster", function (done) {
                const client = newInstance();
                client.connect(function (err) {
                    assert.ifError(err);
                    assert.strictEqual(client.hosts.length, 1);
                    helper.finish(client, done)();
                });
            });
            it("should callback in error when rejecting unauthorized", function (done) {
                const client = newInstance({
                    sslOptions: { rejectUnauthorized: true },
                });
                client.connect(function (err) {
                    helper.assertErrorWithName(err, "NewSessionError");
                    // This value was checked by the DSx integration tests.
                    // Current error handling does not pass this information along.
                    // We may want to add this information considering that we already lose some information,
                    // compared to the information provided by Rust driver
                    // assert.strictEqual(Object.keys(err.innerErrors).length, 1);
                    // helper.assertInstanceOf(
                    //     Object.values(err.innerErrors)[0],
                    //     Error,
                    // );
                    helper.finish(client, done)();
                });
            });
        });
        describe("#execute()", function () {
            it("should handle multiple requests in parallel", function (done) {
                const parallelLimit = 800;
                const client = newInstance();
                utils.series(
                    [
                        client.connect.bind(client),
                        function insert(next) {
                            const query = util.format(
                                "INSERT INTO %s (id, text_sample) VALUES (?, ?)",
                                table,
                            );
                            utils.timesLimit(
                                20000,
                                parallelLimit,
                                function (n, timesNext) {
                                    client.execute(
                                        query,
                                        [types.Uuid.random(), "value " + n],
                                        { prepare: true },
                                        timesNext,
                                    );
                                },
                                next,
                            );
                        },
                    ],
                    helper.finish(client, done),
                );
            });
        });
    });
});

/** @returns {Client}  */
function newInstance(options) {
    return new Client(
        utils.deepExtend(
            { sslOptions: { rejectUnauthorized: false } },
            helper.baseOptions,
            options,
        ),
    );
}
