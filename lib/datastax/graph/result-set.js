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
    // require-yield wants a "yield" in each generator. But throwNotSupported() never returns.
    // Thus, tsc reports a "yield" after it as unreachable code.
    // eslint-disable-next-line require-yield
    *values() {
        throwNotSupported("GraphResultSet.values");
    }

    /**
     * @deprecated Not supported by the driver. Usage will throw an error.
     */
    // require-yield wants a "yield" in each generator. But throwNotSupported() never returns.
    // Thus, tsc reports a "yield" after it as unreachable code.
    // eslint-disable-next-line require-yield
    *getTraversers() {
        throwNotSupported("GraphResultSet.getTraversers");
    }
}

module.exports = GraphResultSet;
