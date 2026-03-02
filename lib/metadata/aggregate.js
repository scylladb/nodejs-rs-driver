"use strict";

/**
 * Describes a CQL aggregate.
 * @alias module:metadata~Aggregate
 */
class Aggregate {
    /**
     * Creates a new Aggregate.
     */
    constructor() {
        /**
         * Name of the aggregate.
         * @type {String}
         */
        this.name = null;
        /**
         * Name of the keyspace where the aggregate is declared.
         */
        this.keyspaceName = null;
        /**
         * Signature of the aggregate.
         * @type {Array.<String>}
         */
        this.signature = null;
        /**
         * List of the CQL aggregate argument types.
         * @type {Array.<{code, info}>}
         */
        this.argumentTypes = null;
        /**
         * State Function.
         * @type {String}
         */
        this.stateFunction = null;
        /**
         * State Type.
         * @type {{code, info}}
         */
        this.stateType = null;
        /**
         * Final Function.
         * @type {String}
         */
        this.finalFunction = null;
        this.initConditionRaw = null;
        /**
         * Initial state value of this aggregate.
         * @type {String}
         */
        this.initCondition = null;
        /**
         * Type of the return value.
         * @type {{code: number, info: (Object|Array|null)}}
         */
        this.returnType = null;
        /**
         * Indicates whether or not this aggregate is deterministic.  This means that
         * given a particular input, the aggregate will always produce the same output.
         * @type {Boolean}
         */
        this.deterministic = null;
    }
}

module.exports = Aggregate;
