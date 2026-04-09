// @ts-nocheck
"use strict";

const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Element {
    constructor(id, label) {
        throwNotSupported("Element");
    }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Vertex {
    constructor(id, label, properties) {
        throwNotSupported("Vertex");
    }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Edge {
    constructor(id, outV, outVLabel, label, inV, inVLabel, properties) {
        throwNotSupported("Edge");
    }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class VertexProperty {
    constructor(id, label, value, properties) {
        throwNotSupported("VertexProperty");
    }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Property {
    constructor(key, value) {
        throwNotSupported("Property");
    }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Path {
    constructor(labels, objects) {
        throwNotSupported("Path");
    }
}

module.exports = {
    Edge,
    Element,
    Path,
    Property,
    Vertex,
    VertexProperty,
};
