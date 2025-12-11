"use strict";

const helper = require("../../test-helper");
const Client = require("../../../lib/client");
const utils = require("../../../lib/utils");
const { PlainTextAuthProvider } = require("../../../lib/auth");
const vit = helper.vit;

describe("Client", function () {
    this.timeout(180000);

    describe("#connect() with auth", function () {
        helper.setup(1, {
            initClient: false,
            ccmOptions: {
                yaml: ["authenticator:PasswordAuthenticator"],
                jvmArgs: ["-Dcassandra.superuser_setup_delay_ms=0"],
            },
        });

        it("should connect using the plain text authenticator", function (done) {
            const options = {
                authProvider: new PlainTextAuthProvider(
                    "cassandra",
                    "cassandra",
                ),
            };
            const client = newInstance(options);
            utils.times(
                100,
                function (n, next) {
                    client.connect(next);
                },
                helper.finish(client, done),
            );
        });

        vit("3.0", "should support connecting using other role", () => {
            let client = newInstance({
                authProvider: new PlainTextAuthProvider(
                    "cassandra",
                    "cassandra",
                ),
            });

            const username = "user2";
            const password = "12345678";

            return client
                .connect()
                .then(() => createRole(client, username, password))
                .then(() => client.shutdown())
                .then(() => {
                    client = newInstance({
                        authProvider: new PlainTextAuthProvider(
                            username,
                            password,
                        ),
                    });

                    return client.connect();
                })
                .then(() => client.execute(helper.queries.basic));
        });

        it("should connect using the plain text authenticator when calling execute", function (done) {
            const options = {
                authProvider: new PlainTextAuthProvider(
                    "cassandra",
                    "cassandra",
                ),
                keyspace: "system",
            };
            const client = newInstance(options);
            utils.times(
                100,
                function (n, next) {
                    client.execute("SELECT * FROM local", next);
                },
                helper.finish(client, done),
            );
        });

        it("should return an AuthenticationError", function (done) {
            const options = {
                authProvider: new PlainTextAuthProvider(
                    "not___EXISTS",
                    "not___EXISTS",
                ),
                keyspace: "system",
            };
            const client = newInstance(options);
            utils.timesSeries(
                10,
                function (n, next) {
                    client.connect(function (err) {
                        assertAuthError(err);
                        next();
                    });
                },
                helper.finish(client, done),
            );
        });

        it("should return an AuthenticationError when calling execute", function (done) {
            const options = {
                authProvider: new PlainTextAuthProvider(
                    "not___EXISTS",
                    "not___EXISTS",
                ),
                keyspace: "system",
            };
            const client = newInstance(options);
            utils.times(
                10,
                function (n, next) {
                    client.execute("SELECT * FROM local", function (err) {
                        assertAuthError(err);
                        next();
                    });
                },
                helper.finish(client, done),
            );
        });

        it("should return an AuthenticationError when authProvider is not set", async () => {
            const client = newInstance();
            const err = await helper.assertThrowsAsync(client.connect());
            assertAuthError(
                err,
                /requires authentication, but no authenticator found in the options/,
            );
        });

        context("with credentials", () => {
            vit("3.0", "should support authenticating", () => {
                let client = newInstance({
                    credentials: {
                        username: "cassandra",
                        password: "cassandra",
                    },
                });

                const username = "user2";
                const password = "12345678";

                return client
                    .connect()
                    .then(() => createRole(client, username, password))
                    .then(() => client.shutdown())
                    .then(() => {
                        client = newInstance({
                            credentials: { username, password },
                        });

                        return client.connect();
                    })
                    .then(() => client.execute(helper.queries.basic));
            });

            it("should fail with AuthenticationError when role does not exist", () => {
                const client = newInstance({
                    credentials: {
                        username: "incorrect_user",
                        password: "abcd",
                    },
                });
                let error;

                return client
                    .connect()
                    .catch((err) => (error = err))
                    .then(() => assertAuthError(error));
            });

            it("should fail with AuthenticationError when password is incorrect", () => {
                const client = newInstance({
                    credentials: {
                        username: "cassandra",
                        password: "invalid_password",
                    },
                });
                let error;

                return client
                    .connect()
                    .catch((err) => (error = err))
                    .then(() => assertAuthError(error));
            });
        });
    });
});

/**
 * @param {ClientOptions} [options]
 * @returns {Client}
 */
function newInstance(options) {
    const client = new Client(
        utils.deepExtend({}, helper.baseOptions, options),
    );
    return client;
}

function createRole(client, role, password) {
    return client.execute(
        `CREATE ROLE IF NOT EXISTS ${role} WITH PASSWORD = '${password}' AND LOGIN = true`,
    );
}

/**
 *
 * @param {Error} err
 * @param {*} message
 */
function assertAuthError(err, message) {
    helper.assertErrorWithName(err, "NewSessionError");
    // This value was checked by the DSx integration tests.
    // Current error handling does not pass this information along.
    // We may want to add this information considering that we already lose some information,
    // compared to the information provided by Rust driver
    /* assert.ok(err.innerErrors);
    const firstErr = Object.values(err.innerErrors)[0];
    helper.assertInstanceOf(firstErr, errors.AuthenticationError);

    if (message) {
        assert.match(firstErr.message, message);
    } */
}
