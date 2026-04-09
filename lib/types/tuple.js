// @ts-nocheck
"use strict";

/** @module types */

/**
 * Represents a sequence of immutable objects.
 *
 * Tuples are sequences, just like Arrays. The only difference is that tuples are read only.
 *
 * As tuples can be used as Map keys, the {{@link module:types~Tuple#toString toString}} method calls toString for each element,
 * trying to get a unique string key.
 */
class Tuple {
    /**
     * Elements of the tuple.
     * @type {Array}
     * @private
     */
    #elements;

    /**
     * Creates a new instance of Tuple.
     * @param  {...any} args
     */
    constructor(...args) {
        this.#elements = args;

        if (this.elements.length === 0) {
            throw new TypeError("Tuple must contain at least one value");
        }
    }

    /**
     * Returns elements of the tuple.
     * @readonly
     * @type Array
     */
    get elements() {
        return this.#elements;
    }

    set elements(_) {
        throw new SyntaxError("Tuple elements are read-only");
    }

    /**
     * Returns the number of the elements.
     * @readonly
     * @type Number
     */
    get length() {
        return this.#elements.length;
    }

    set length(_) {
        throw new SyntaxError("Tuple length is read-only");
    }

    /**
     * Creates a new instance of Tuple from an Array.
     * @param {Array} elements
     * @returns {Tuple}
     */
    static fromArray(elements) {
        // Use the elements of an Array as function parameters.
        return new Tuple(...elements);
    }

    /**
     * Returns value located at the given index.
     * @param {Number} index Element index
     */
    get(index) {
        return this.#elements[index || 0];
    }

    /**
     * Returns a string representation of the sequence, surrounded by parenthesis, ie: (1, 2).
     *
     * The returned value attempts to be a unique string representation of its values.
     *
     * @returns {string}
     */
    toString() {
        return `(${this.elements.reduce((prev, x, i) => {
            return prev + (i > 0 ? "," : "") + x.toString();
        }, "")})`;
    }

    /**
     * Returns an Array representation of the sequence.
     * @returns {Array}
     */
    toJSON() {
        return this.elements;
    }

    /**
     * Gets the elements as an Array.
     * @returns {Array}
     */
    values() {
        // Clone the elements
        return this.elements.slice(0);
    }
}

module.exports = Tuple;
