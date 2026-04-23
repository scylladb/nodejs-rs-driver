"use strict";

const { throwNotSupported } = require("../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Point {
    constructor() {
        throwNotSupported("Point");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromBuffer() {
        throwNotSupported("Point.fromBuffer");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromString() {
        throwNotSupported("Point.fromString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toBuffer() {
        throwNotSupported("Point.toBuffer");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    equals() {
        throwNotSupported("Point.equals");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toString() {
        throwNotSupported("Point.toString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toJSON() {
        throwNotSupported("Point.toJSON");
    }
}

module.exports = Point;
