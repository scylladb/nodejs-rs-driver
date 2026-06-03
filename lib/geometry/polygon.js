"use strict";

const { throwNotSupported } = require("../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Polygon {
  constructor() {
    throwNotSupported("Polygon");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  static fromBuffer() {
    throwNotSupported("Polygon.fromBuffer");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  static fromString() {
    throwNotSupported("Polygon.fromString");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  toBuffer() {
    throwNotSupported("Polygon.toBuffer");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  equals() {
    throwNotSupported("Polygon.equals");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  toString() {
    throwNotSupported("Polygon.toString");
  }

  /**
   * @deprecated Not supported by the driver. Usage will throw an error.
   */
  toJSON() {
    throwNotSupported("Polygon.toJSON");
  }
}

module.exports = Polygon;
