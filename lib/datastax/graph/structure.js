"use strict";

const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Element {
  constructor() {
    throwNotSupported("Element");
  }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Vertex {
  constructor() {
    throwNotSupported("Vertex");
  }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Edge {
  constructor() {
    throwNotSupported("Edge");
  }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class VertexProperty {
  constructor() {
    throwNotSupported("VertexProperty");
  }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Property {
  constructor() {
    throwNotSupported("Property");
  }
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Path {
  constructor() {
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
