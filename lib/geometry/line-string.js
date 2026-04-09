// @ts-nocheck
"use strict";

const { throwNotSupported } = require("../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class LineString {
    constructor(point) {
        throwNotSupported("LineString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromBuffer(buffer) {
        throwNotSupported("LineString.fromBuffer");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromString(textValue) {
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
    equals(other) {
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
