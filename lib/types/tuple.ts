/** @module types */

/**
 * Represents a sequence of immutable objects.
 *
 * Tuples are sequences, just like Arrays. The only difference is that tuples are read only.
 *
 * As tuples can be used as Map keys, the {@link module:types~Tuple#toString toString} method calls toString for each element,
 * trying to get a unique string key.
 */
class Tuple {
    /**
     * Elements of the tuple.
     */
    #elements: any[];

    /**
     * Creates a new instance of Tuple.
     */
    constructor(...args: any[]) {
        this.#elements = args;

        if (this.elements.length === 0) {
            throw new TypeError("Tuple must contain at least one value");
        }
    }

    /**
     * Returns elements of the tuple.
     * @readonly
     */
    get elements(): any[] {
        return this.#elements;
    }

    set elements(_: any[]) {
        throw new SyntaxError("Tuple elements are read-only");
    }

    /**
     * Returns the number of the elements.
     * @readonly
     */
    get length(): number {
        return this.#elements.length;
    }

    set length(_: number) {
        throw new SyntaxError("Tuple length is read-only");
    }

    /**
     * Creates a new instance of Tuple from an Array.
     */
    static fromArray(elements: any[]): Tuple {
        // Use the elements of an Array as function parameters.
        return new Tuple(...elements);
    }

    /**
     * Returns value located at the given index.
     * @param index Element index
     */
    get(index: number): any {
        return this.#elements[index || 0];
    }

    /**
     * Returns a string representation of the sequence, surrounded by parenthesis, ie: (1, 2).
     *
     * The returned value attempts to be a unique string representation of its values.
     */
    toString(): string {
        return `(${this.elements.reduce((prev: string, x: any, i: number) => {
            return prev + (i > 0 ? "," : "") + x.toString();
        }, "")})`;
    }

    /**
     * Returns an Array representation of the sequence.
     */
    toJSON(): any[] {
        return this.elements;
    }

    /**
     * Gets the elements as an Array.
     */
    values(): any[] {
        // Clone the elements
        return this.elements.slice(0);
    }
}

export = Tuple;
