"use strict";
/** @module types */

import util = require("node:util");

class Vector {
    elements: Array<any>;
    /**
     * Returns the number of the elements.
     */
    length: number;
    subtype?: string;

    constructor(elements: Float32Array | Array<any>, subtype?: string) {
        if (elements instanceof Float32Array) {
            this.elements = Array.from(elements);
        } else if (Array.isArray(elements)) {
            this.elements = elements;
        } else {
            throw new TypeError(
                "Vector must be constructed with a Float32Array or an Array",
            );
        }
        if (this.elements.length === 0) {
            throw new TypeError("Vector must contain at least one value");
        }
        this.length = this.elements.length;
        this.subtype = subtype;

        // eslint-disable-next-line no-constructor-return
        return new Proxy(this, {
            get: function (obj: any, key) {
                if (key === "IDENTITY") {
                    return "Vector";
                } else if (
                    typeof key === "string" &&
                    Number.isInteger(Number(key))
                ) {
                    // key is an index
                    return obj.elements[key];
                }
                return obj[key];
            },
            set: function (obj: any, key, value) {
                if (typeof key === "string" && Number.isInteger(Number(key))) {
                    // key is an index
                    return (obj.elements[key] = value);
                }
                return (obj[key] = value);
            },
            ownKeys: function () {
                return Reflect.ownKeys(elements);
            },
            getOwnPropertyDescriptor(target, key) {
                if (typeof key === "string" && Number.isInteger(Number(key))) {
                    // array index
                    return { enumerable: true, configurable: true };
                }
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
        });
    }
    /**
     * Returns the string representation of the vector.
     */
    toString(): string {
        return "[".concat(this.elements.toString(), "]");
    }

    at(index: number): any {
        return this.elements[index];
    }

    /**
     * @returns an iterator over the elements of the vector
     */
    [Symbol.iterator](): IterableIterator<any> {
        return this.elements[Symbol.iterator]();
    }

    static get [Symbol.species](): typeof Vector {
        return Vector;
    }

    forEach(
        callback: (value: any, index: number, array: Array<any>) => void,
    ): void {
        return this.elements.forEach(callback);
    }

    /**
     * @returns get the subtype string, e.g., "float", but it's optional so it can return undefined
     */
    getSubtype(): string | undefined {
        return this.subtype;
    }
}

Object.defineProperty(Vector, Symbol.hasInstance, {
    value: function (i: any) {
        return (
            (util.types.isProxy(i) && i.IDENTITY === "Vector") ||
            i instanceof Float32Array
        );
    },
});

export = Vector;
