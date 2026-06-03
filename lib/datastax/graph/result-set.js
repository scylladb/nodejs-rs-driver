"use strict";

const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class GraphResultSet {
  constructor() {
    throwNotSupported("GraphResultSet");
  }
  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  first() {
    throwNotSupported("GraphResultSet.first");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  forEach() {
    throwNotSupported("GraphResultSet.forEach");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  toArray() {
    throwNotSupported("GraphResultSet.toArray");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  *values() {
    throwNotSupported("GraphResultSet.values");
    yield;
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  *getTraversers() {
    throwNotSupported("GraphResultSet.getTraversers");
    yield;
  }
}

module.exports = GraphResultSet;
