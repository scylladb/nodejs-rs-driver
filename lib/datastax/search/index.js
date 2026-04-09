"use strict";

const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class DateRange {
    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    constructor() {
        throwNotSupported("DateRange.constructor");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    equals() {
        throwNotSupported("DateRange.equals");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toString() {
        throwNotSupported("DateRange.toString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toBuffer() {
        throwNotSupported("DateRange.toBuffer");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromString() {
        throwNotSupported("DateRange.fromString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromBuffer() {
        throwNotSupported("DateRange.fromBuffer");
    }

}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class DateRangeBound {
    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    constructor() {
        throwNotSupported("DateRangeBound.constructor");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    toString() {
        throwNotSupported("DateRangeBound.toString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    equals() {
        throwNotSupported("DateRangeBound.equals");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    isUnbounded() {
        throwNotSupported("DateRangeBound.isUnbounded");
    };

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static fromString() {
        throwNotSupported("DateRangeBound.fromString");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static unbounded = undefined;

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static toLowerBound() {
        throwNotSupported("DateRangeBound.toLowerBound");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    static toUpperBound() {
        throwNotSupported("DateRangeBound.toUpperBound");
    };

}
/**
 * Search module is not supported. Any usage will throw an error
 * @module datastax/search
 */

exports.DateRange = DateRange;
exports.DateRangeBound = DateRangeBound;
