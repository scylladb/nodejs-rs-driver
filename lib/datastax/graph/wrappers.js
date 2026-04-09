// @ts-nocheck
"use strict";

const { throwNotSupported } = require("../../new-utils");

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asInt(value) {
    throwNotSupported("asInt");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asDouble(value) {
    throwNotSupported("asDouble");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asFloat(value) {
    throwNotSupported("asFloat");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asTimestamp(value) {
    throwNotSupported("asTimestamp");
}

/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
function asUdt(value, udtInfo) {
    throwNotSupported("asUdt");
}

module.exports = {
    asInt,
    asDouble,
    asFloat,
    asTimestamp,
    asUdt,
};
