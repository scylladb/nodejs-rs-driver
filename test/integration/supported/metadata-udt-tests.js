"use strict";
const assert = require("chai").assert;

const helper = require("../../test-helper");
const utils = require("../../../lib/utils");
const { CqlType } = require("../../../index");

describe("Metadata#getUdt()", function () {
    this.timeout(60000);

    const setupInfo = helper.setup("1:0");

    describe("when called with UDT name", function () {
        it("should return null for non-existent UDT", function (done) {
            const client = setupInfo.client;
            const udt = client.metadata.getUdt(
                setupInfo.keyspace,
                "non_existent_udt",
            );
            assert.isNull(udt);
            done();
        });

        it("should return UserDefinedType for created UDT", function (done) {
            const keyspace = setupInfo.keyspace;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE TYPE ${keyspace}.address_udt (street varchar, zip_code int)`,
                    ),
                    function verifyUdt(next) {
                        const client = setupInfo.client;
                        const udt = client.metadata.getUdt(
                            keyspace,
                            "address_udt",
                        );
                        assert.isNotNull(udt);
                        assert.strictEqual(udt.name, "address_udt");
                        assert.strictEqual(udt.keyspace, keyspace);
                        assert.strictEqual(udt.fields.length, 2);

                        const streetField = udt.fields.find(
                            (f) => f.name === "street",
                        );
                        assert.isDefined(streetField);
                        assert.strictEqual(
                            streetField.type.code,
                            CqlType.Varchar,
                        );

                        const zipCodeField = udt.fields.find(
                            (f) => f.name === "zip_code",
                        );
                        assert.isDefined(zipCodeField);
                        assert.strictEqual(zipCodeField.type.code, CqlType.Int);
                        next();
                    },
                ],
                done,
            );
        });

        it("should return null after dropping the UDT", function (done) {
            const keyspace = setupInfo.keyspace;
            utils.series(
                [
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `CREATE TYPE ${keyspace}.drop_udt (id int)`,
                    ),
                    function verifyExistence(next) {
                        const udt = setupInfo.client.metadata.getUdt(
                            keyspace,
                            "drop_udt",
                        );
                        assert.isNotNull(udt);
                        next();
                    },
                    helper.toTask(
                        setupInfo.client.execute,
                        setupInfo.client,
                        `DROP TYPE ${keyspace}.drop_udt`,
                    ),
                    function verifyDeletion(next) {
                        const udt = setupInfo.client.metadata.getUdt(
                            keyspace,
                            "drop_udt",
                        );
                        assert.isNull(udt);
                        next();
                    },
                ],
                done,
            );
        });
    });
});
