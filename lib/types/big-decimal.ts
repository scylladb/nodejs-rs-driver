import Integer = require("./integer");
import utils = require("../utils");

/** @module types */

/**
 * The `BigDecimal` class provides operations for
 * arithmetic, scale manipulation, rounding, comparison and
 * format conversion. The {@link #toString} method provides a
 * canonical representation of a `BigDecimal`.
 */
class BigDecimal {
    /**
     * @private
     */
    #intVal: Integer;
    /**
     * @private
     */
    #scale: number;

    /**
     * Constructs an immutable arbitrary-precision signed decimal number.
     * A `BigDecimal` consists of an [arbitrary precision integer]{@link module:types~Integer}
     * *unscaled value* and a 32-bit integer *scale*. If zero
     * or positive, the scale is the number of digits to the right of the
     * decimal point. If negative, the unscaled value of the number is
     * multiplied by ten to the power of the negation of the scale. The
     * value of the number represented by the `BigDecimal` is
     * therefore (unscaledValue x 10^(-scale)).
     *
     * @param unscaledValue The integer part of the decimal.
     * @param scale The scale of the decimal.
     */
    constructor(unscaledValue: Integer | number, scale: number) {
        if (typeof unscaledValue === "number") {
            unscaledValue = Integer.fromNumber(unscaledValue);
        }
        this.#intVal = unscaledValue;
        this.#scale = scale;
    }

    /**
     * Returns the BigDecimal representation of a buffer composed of the scale (int32BE) and the unsigned value (varint BE)
     */
    static fromBuffer(buf: Buffer): BigDecimal {
        const scale = buf.readInt32BE(0);
        const unscaledValue = Integer.fromBuffer(buf.slice(4));
        return new BigDecimal(unscaledValue, scale);
    }

    /**
     * Returns a buffer representation composed of the scale as a BE int 32 and the unsigned value as a BE varint
     */
    static toBuffer(value: BigDecimal): Buffer {
        const unscaledValueBuffer = Integer.toBuffer(value.#intVal);
        const scaleBuffer = utils.allocBufferUnsafe(4);
        scaleBuffer.writeInt32BE(value.#scale, 0);
        return Buffer.concat(
            [scaleBuffer, unscaledValueBuffer],
            scaleBuffer.length + unscaledValueBuffer.length,
        );
    }

    /**
     * Returns a BigDecimal representation of the string
     */
    static fromString(value: string): BigDecimal {
        if (!value) {
            throw new TypeError("Invalid null or undefined value");
        }
        value = value.trim();
        const scaleIndex = value.indexOf(".");
        let scale = 0;
        if (scaleIndex >= 0) {
            scale = value.length - 1 - scaleIndex;
            value = value.substr(0, scaleIndex) + value.substr(scaleIndex + 1);
        }
        return new BigDecimal(Integer.fromString(value), scale);
    }

    /**
     * Returns a BigDecimal representation of the Number
     */
    static fromNumber(value: number): BigDecimal {
        if (isNaN(value)) {
            return new BigDecimal(Integer.ZERO, 0);
        }
        let textValue = value.toString();
        if (textValue.indexOf("e") >= 0) {
            // get until scale 20
            textValue = value.toFixed(20);
        }
        return BigDecimal.fromString(textValue);
    }

    /**
     * Returns true if the value of the BigDecimal instance and other are the same
     */
    equals(other: BigDecimal): boolean {
        return other instanceof BigDecimal && this.compare(other) === 0;
    }

    inspect(): string {
        return this.constructor.name + ": " + this.toString();
    }

    notEquals(other: BigDecimal): boolean {
        return !this.equals(other);
    }

    /**
     * Compares this BigDecimal with the given one.
     * @param other Integer to compare against.
     * @return 0 if they are the same, 1 if the this is greater, and -1
     *     if the given one is greater.
     */
    compare(other: BigDecimal): number {
        const diff = this.subtract(other);
        if (diff.isNegative()) {
            return -1;
        }
        if (diff.isZero()) {
            return 0;
        }
        return +1;
    }

    /**
     * Returns the difference of this and the given BigDecimal.
     * @param other The BigDecimal to subtract from this.
     * @return The BigDecimal result.
     */
    subtract(other: BigDecimal): BigDecimal {
        const first = this;
        if (first.#scale === other.#scale) {
            return new BigDecimal(
                first.#intVal.subtract(other.#intVal),
                first.#scale,
            );
        }
        let diffScale;
        let unscaledValue;
        if (first.#scale < other.#scale) {
            // The scale of this is lower
            diffScale = other.#scale - first.#scale;
            // multiple this unScaledValue to compare in the same scale
            unscaledValue = first.#intVal
                .multiply(Integer.fromNumber(Math.pow(10, diffScale)))
                .subtract(other.#intVal);
            return new BigDecimal(unscaledValue, other.#scale);
        }
        // The scale of this is higher
        diffScale = first.#scale - other.#scale;
        // multiple this unScaledValue to compare in the same scale
        unscaledValue = first.#intVal.subtract(
            other.#intVal.multiply(Integer.fromNumber(Math.pow(10, diffScale))),
        );
        return new BigDecimal(unscaledValue, first.#scale);
    }

    /**
     * Returns the sum of this and the given BigDecimal.
     * @param other The BigDecimal to sum to this.
     * @return The BigDecimal result.
     */
    add(other: BigDecimal): BigDecimal {
        const first = this;
        if (first.#scale === other.#scale) {
            return new BigDecimal(
                first.#intVal.add(other.#intVal),
                first.#scale,
            );
        }
        let diffScale;
        let unscaledValue;
        if (first.#scale < other.#scale) {
            // The scale of this is lower
            diffScale = other.#scale - first.#scale;
            // multiple this unScaledValue to compare in the same scale
            unscaledValue = first.#intVal
                .multiply(Integer.fromNumber(Math.pow(10, diffScale)))
                .add(other.#intVal);
            return new BigDecimal(unscaledValue, other.#scale);
        }
        // The scale of this is higher
        diffScale = first.#scale - other.#scale;
        // multiple this unScaledValue to compare in the same scale
        unscaledValue = first.#intVal.add(
            other.#intVal.multiply(Integer.fromNumber(Math.pow(10, diffScale))),
        );
        return new BigDecimal(unscaledValue, first.#scale);
    }

    /**
     * Returns true if the current instance is greater than the other
     */
    greaterThan(other: BigDecimal): boolean {
        return this.compare(other) === 1;
    }

    /** Whether this value is negative. */
    isNegative(): boolean {
        return this.#intVal.isNegative();
    }

    /** Whether this value is zero. */
    isZero(): boolean {
        return this.#intVal.isZero();
    }

    /**
     * Returns the string representation of this BigDecimal
     */
    toString(): string {
        let intString = this.#intVal.toString();
        if (this.#scale === 0) {
            return intString;
        }
        let signSymbol = "";
        if (intString.charAt(0) === "-") {
            signSymbol = "-";
            intString = intString.substr(1);
        }
        let separatorIndex = intString.length - this.#scale;
        if (separatorIndex <= 0) {
            // add zeros at the beginning, plus an additional zero
            intString =
                utils.stringRepeat("0", -separatorIndex + 1) + intString;
            separatorIndex = intString.length - this.#scale;
        }
        return (
            signSymbol +
            intString.substr(0, separatorIndex) +
            "." +
            intString.substr(separatorIndex)
        );
    }

    /**
     * Returns a Number representation of this `BigDecimal`.
     */
    toNumber(): number {
        return parseFloat(this.toString());
    }

    /**
     * Returns the string representation.
     * Method used by the native JSON.stringify() to serialize this instance.
     */
    toJSON(): string {
        return this.toString();
    }
}

export = BigDecimal;
