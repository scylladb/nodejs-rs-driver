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
    _intVal: Integer;
    /**
     * @private
     */
    _scale: number;

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
        this._intVal = unscaledValue;
        this._scale = scale;
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
        const unscaledValueBuffer = Integer.toBuffer(value._intVal);
        const scaleBuffer = utils.allocBufferUnsafe(4);
        scaleBuffer.writeInt32BE(value._scale, 0);
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
        if (first._scale === other._scale) {
            return new BigDecimal(
                first._intVal.subtract(other._intVal),
                first._scale,
            );
        }
        let diffScale;
        let unscaledValue;
        if (first._scale < other._scale) {
            // The scale of this is lower
            diffScale = other._scale - first._scale;
            // multiple this unScaledValue to compare in the same scale
            unscaledValue = first._intVal
                .multiply(Integer.fromNumber(Math.pow(10, diffScale)))
                .subtract(other._intVal);
            return new BigDecimal(unscaledValue, other._scale);
        }
        // The scale of this is higher
        diffScale = first._scale - other._scale;
        // multiple this unScaledValue to compare in the same scale
        unscaledValue = first._intVal.subtract(
            other._intVal.multiply(Integer.fromNumber(Math.pow(10, diffScale))),
        );
        return new BigDecimal(unscaledValue, first._scale);
    }

    /**
     * Returns the sum of this and the given BigDecimal.
     * @param other The BigDecimal to sum to this.
     * @return The BigDecimal result.
     */
    add(other: BigDecimal): BigDecimal {
        const first = this;
        if (first._scale === other._scale) {
            return new BigDecimal(
                first._intVal.add(other._intVal),
                first._scale,
            );
        }
        let diffScale;
        let unscaledValue;
        if (first._scale < other._scale) {
            // The scale of this is lower
            diffScale = other._scale - first._scale;
            // multiple this unScaledValue to compare in the same scale
            unscaledValue = first._intVal
                .multiply(Integer.fromNumber(Math.pow(10, diffScale)))
                .add(other._intVal);
            return new BigDecimal(unscaledValue, other._scale);
        }
        // The scale of this is higher
        diffScale = first._scale - other._scale;
        // multiple this unScaledValue to compare in the same scale
        unscaledValue = first._intVal.add(
            other._intVal.multiply(Integer.fromNumber(Math.pow(10, diffScale))),
        );
        return new BigDecimal(unscaledValue, first._scale);
    }

    /**
     * Returns true if the current instance is greater than the other
     */
    greaterThan(other: BigDecimal): boolean {
        return this.compare(other) === 1;
    }

    /** Whether this value is negative. */
    isNegative(): boolean {
        return this._intVal.isNegative();
    }

    /** Whether this value is zero. */
    isZero(): boolean {
        return this._intVal.isZero();
    }

    /**
     * Returns the string representation of this BigDecimal
     */
    toString(): string {
        let intString = this._intVal.toString();
        if (this._scale === 0) {
            return intString;
        }
        let signSymbol = "";
        if (intString.charAt(0) === "-") {
            signSymbol = "-";
            intString = intString.substr(1);
        }
        let separatorIndex = intString.length - this._scale;
        if (separatorIndex <= 0) {
            // add zeros at the beginning, plus an additional zero
            intString =
                utils.stringRepeat("0", -separatorIndex + 1) + intString;
            separatorIndex = intString.length - this._scale;
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
