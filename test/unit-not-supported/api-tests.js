"use strict";
const { assert } = require("chai");
const api = require("../../");

describe("API", function () {
    it("should expose expose deprecated datastax auth module", function () {
        assert.ok(api.auth);
        assert.strictEqual(
            typeof api.auth.DsePlainTextAuthProvider,
            "function",
        );
        assert.strictEqual(typeof api.auth.DseGssapiAuthProvider, "function");
    });

    it("should expose geometry module", function () {
        assert.ok(api.geometry);
        checkConstructor(api.geometry, "LineString");
        checkConstructor(api.geometry, "Point");
        checkConstructor(api.geometry, "Polygon");
    });

    it("should expose Client constructor", function () {
        checkConstructor(api, "Client");
    });

    it("should expose GraphResultSet constructor", function () {
        checkConstructor(api.datastax.graph, "GraphResultSet");
    });

    it("should expose graph types constructor", function () {
        checkConstructor(api.datastax.graph, "Edge");
        checkConstructor(api.datastax.graph, "Element");
        checkConstructor(api.datastax.graph, "Path");
        checkConstructor(api.datastax.graph, "Property");
        checkConstructor(api.datastax.graph, "Vertex");
        checkConstructor(api.datastax.graph, "VertexProperty");
    });

    it("should expose cassandra driver modules", function () {
        assert.ok(api.errors);
        assert.ok(api.policies);
        assert.ok(api.policies.loadBalancing);
        checkConstructor(api.policies.loadBalancing, "AllowListPolicy");
        assert.ok(api.policies.retry);
        assert.ok(api.policies.reconnection);
        assert.ok(api.metadata);
        assert.ok(api.types);
        checkConstructor(api.types, "BigDecimal");
        checkConstructor(api.types, "Integer");
        checkConstructor(api.types, "InetAddress");
        checkConstructor(api.types, "Uuid");
        checkConstructor(api.types, "TimeUuid");
    });
});

function checkConstructor(module, constructorName) {
    assert.strictEqual(typeof module[constructorName], "function");
    // use Function.name
    assert.strictEqual(module[constructorName].name, constructorName);
}
