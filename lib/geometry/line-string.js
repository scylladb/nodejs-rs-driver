"use strict";

const { throwNotSupported } = require("../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class LineString {
    constructor() {
        throwNotSupported("LineString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromBuffer() {
        throwNotSupported("LineString.fromBuffer");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromString() {
        throwNotSupported("LineString.fromString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toBuffer() {
        throwNotSupported("LineString.toBuffer");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    equals() {
        throwNotSupported("LineString.equals");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toString() {
        throwNotSupported("LineString.toString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toJSON() {
        throwNotSupported("LineString.toJSON");
    }
}

module.exports = LineString;
