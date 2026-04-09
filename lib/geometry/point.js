// @ts-nocheck
"use strict";

const { throwNotSupported } = require("../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Point {
    constructor(x, y) {
        throwNotSupported("Point");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromBuffer(buffer) {
        throwNotSupported("Point.fromBuffer");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromString(textValue) {
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
    equals(other) {
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
