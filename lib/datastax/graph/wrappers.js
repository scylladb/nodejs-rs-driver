"use strict";

const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asInt() {
    throwNotSupported("asInt");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asDouble() {
    throwNotSupported("asDouble");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asFloat() {
    throwNotSupported("asFloat");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asTimestamp() {
    throwNotSupported("asTimestamp");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asUdt() {
    throwNotSupported("asUdt");
}

module.exports = {
    asInt,
    asDouble,
    asFloat,
    asTimestamp,
    asUdt,
};
