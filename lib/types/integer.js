// @ts-nocheck
/** @module types */

const utils = require("../utils");

/**
 * The internal representation of an integer is an array of 32-bit signed
 * pieces, along with a sign (0 or -1) that indicates the contents of all the
 * other 32-bit pieces out to infinity.  We use 32-bit pieces because these are
 * the size of integers on which Javascript performs bit-operations.  For
 * operations like addition and multiplication, we split each number into 16-bit
 * pieces, which can easily be multiplied within Javascript's floating-point
 * representation without overflow or change in sign.
 *
 * @final
 * @deprecated Use either Long or builtin BigInt type instead of Integer.
 * This class will be remover at a later time.
 */
class Integer {
    /** @type {!Array.<number>} */
    #bits;
    /** @type {number} */
    #sign;

    /**
     * Constructs a two's-complement integer an array containing bits of the
     * integer in 32-bit (signed) pieces, given in little-endian order (i.e.,
     * lowest-order bits in the first piece), and the sign of -1 or 0.
     *
     * See the from* functions below for other convenient ways of constructing
     * Integers.
     * @param {Array.<number>} bits Array containing the bits of the number.
     * @param {number} sign The sign of the number: -1 for negative and 0 positive.
     */
    constructor(bits, sign) {
        /**
         * @type {!Array.<number>}
         * @private
         */
        this.#bits = [];

        /**
         * @type {number}
         * @private
         */
        this.#sign = sign;

        // Copy the 32-bit signed integer values passed in.  We prune out those at the
        // top that equal the sign since they are redundant.
        let top = true;
        for (let i = bits.length - 1; i >= 0; i--) {
            let val = bits[i] | 0;
            if (!top || val != sign) {
                this.#bits[i] = val;
                top = false;
            }
        }
    }
    /**
     * Returns an Integer representing the given (32-bit) integer value.
     * @param {number} value A 32-bit integer value.
     * @return {!Integer} The corresponding Integer value.
     */
    static fromInt(value) {
        if (-128 <= value && value < 128) {
            let cachedObj = Integer.IntCache_[value];
            if (cachedObj) {
                return cachedObj;
            }
        }

        let obj = new Integer([value | 0], value < 0 ? -1 : 0);
        if (-128 <= value && value < 128) {
            Integer.IntCache_[value] = obj;
        }
        return obj;
    }
    /**
     * Returns an Integer representing the given value, provided that it is a finite
     * number.  Otherwise, zero is returned.
     * @param {number} value The value in question.
     * @return {!Integer} The corresponding Integer value.
     */
    static fromNumber(value) {
        if (isNaN(value) || !isFinite(value)) {
            return Integer.ZERO;
        } else if (value < 0) {
            return Integer.fromNumber(-value).negate();
        }
        let bits = [];
        let pow = 1;
        for (let i = 0; value >= pow; i++) {
            bits[i] = (value / pow) | 0;
            pow *= Integer.TWO_PWR_32_DBL_;
        }
        return new Integer(bits, 0);
    }
    /**
     * Returns a Integer representing the value that comes by concatenating the
     * given entries, each is assumed to be 32 signed bits, given in little-endian
     * order (lowest order bits in the lowest index), and sign-extending the highest
     * order 32-bit value.
     * @param {Array.<number>} bits The bits of the number, in 32-bit signed pieces,
     *     in little-endian order.
     * @return {!Integer} The corresponding Integer value.
     */
    static fromBits(bits) {
        let high = bits[bits.length - 1];
        // noinspection JSBitwiseOperatorUsage
        return new Integer(bits, high & (1 << 31) ? -1 : 0);
    }
    /**
     * Returns an Integer representation of the given string, written using the
     * given radix.
     * @param {string} str The textual representation of the Integer.
     * @param {number=} optRadix The radix in which the text is written.
     * @return {!Integer} The corresponding Integer value.
     */
    static fromString(str, optRadix) {
        if (str.length == 0) {
            throw TypeError("number format error: empty string");
        }

        let radix = optRadix || 10;
        if (radix < 2 || 36 < radix) {
            throw Error("radix out of range: " + radix);
        }

        if (str.charAt(0) == "-") {
            return Integer.fromString(str.substring(1), radix).negate();
        } else if (str.indexOf("-") >= 0) {
            throw TypeError('number format error: interior "-" character');
        }

        // Do several (8) digits each time through the loop, so as to
        // minimize the calls to the very expensive emulated div.
        let radixToPower = Integer.fromNumber(Math.pow(radix, 8));

        let result = Integer.ZERO;
        for (let i = 0; i < str.length; i += 8) {
            let size = Math.min(8, str.length - i);
            let value = parseInt(str.substring(i, i + size), radix);
            if (size < 8) {
                let power = Integer.fromNumber(Math.pow(radix, size));
                result = result.multiply(power).add(Integer.fromNumber(value));
            } else {
                result = result.multiply(radixToPower);
                result = result.add(Integer.fromNumber(value));
            }
        }
        return result;
    }
    /**
     * Returns an Integer representation of a given big endian Buffer.
     * The internal representation of bits contains bytes in groups of 4
     * @param {Buffer} buf
     * @returns {Integer}
     */
    static fromBuffer(buf) {
        let bits = new Array(Math.ceil(buf.length / 4));
        // noinspection JSBitwiseOperatorUsage
        let sign = buf[0] & (1 << 7) ? -1 : 0;
        for (let i = 0; i < bits.length; i++) {
            let offset = buf.length - (i + 1) * 4;
            let value;
            if (offset < 0) {
                // The buffer length is not multiple of 4
                offset = offset + 4;
                value = 0;
                for (let j = 0; j < offset; j++) {
                    let byte = buf[j];
                    if (sign === -1) {
                        // invert the bits
                        byte = ~byte & 0xff;
                    }
                    value = value | (byte << ((offset - j - 1) * 8));
                }
                if (sign === -1) {
                    // invert all the bits
                    value = ~value;
                }
            } else {
                value = buf.readInt32BE(offset);
            }
            bits[i] = value;
        }
        return new Integer(bits, sign);
    }
    /**
     * Returns a big endian buffer representation of an Integer.
     * Internally the bits are represented using 4 bytes groups (numbers),
     * in the Buffer representation there might be the case where we need less than the 4 bytes.
     * For example: 0x00000001 -> '01', 0xFFFFFFFF -> 'FF', 0xFFFFFF01 -> 'FF01'
     * @param {Integer} value
     * @returns {Buffer}
     */
    static toBuffer(value) {
        let sign = value.#sign;
        let bits = value.#bits;
        if (bits.length === 0) {
            // [0] or [0xffffffff]
            return utils.allocBufferFromArray([value.#sign]);
        }
        // the high bits might need to be represented in less than 4 bytes
        let highBits = bits[bits.length - 1];
        if (sign === -1) {
            highBits = ~highBits;
        }
        let high = [];
        if (highBits >>> 24 > 0) {
            high.push((highBits >> 24) & 0xff);
        }
        if (highBits >>> 16 > 0) {
            high.push((highBits >> 16) & 0xff);
        }
        if (highBits >>> 8 > 0) {
            high.push((highBits >> 8) & 0xff);
        }
        high.push(highBits & 0xff);
        if (sign === -1) {
            // The byte containing the sign bit got removed
            if (high[0] >> 7 !== 0) {
                // it is going to be negated
                high.unshift(0);
            }
        } else if (high[0] >> 7 !== 0) {
            // its positive but it lost the byte containing the sign bit
            high.unshift(0);
        }
        let buf = utils.allocBufferUnsafe(high.length + (bits.length - 1) * 4);
        for (let j = 0; j < high.length; j++) {
            let b = high[j];
            if (sign === -1) {
                buf[j] = ~b;
            } else {
                buf[j] = b;
            }
        }
        for (let i = 0; i < bits.length - 1; i++) {
            let group = bits[bits.length - 2 - i];
            let offset = high.length + i * 4;
            buf.writeInt32BE(group, offset);
        }
        return buf;
    }
    /**
     * Carries any overflow from the given index into later entries.
     * @param {Array.<number>} bits Array of 16-bit values in little-endian order.
     * @param {number} index The index in question.
     * @private
     */
    static #carry16(bits, index) {
        while ((bits[index] & 0xffff) != bits[index]) {
            bits[index + 1] += bits[index] >>> 16;
            bits[index] &= 0xffff;
        }
    }
    /**
     * Returns the value, assuming it is a 32-bit integer.
     * @return {number} The corresponding int value.
     */
    toInt() {
        return this.#bits.length > 0 ? this.#bits[0] : this.#sign;
    }
    /** @return {number} The closest floating-point representation to this value. */
    toNumber() {
        if (this.isNegative()) {
            return -this.negate().toNumber();
        }
        let val = 0;
        let pow = 1;
        for (let i = 0; i < this.#bits.length; i++) {
            val += this.getBitsUnsigned(i) * pow;
            pow *= Integer.TWO_PWR_32_DBL_;
        }
        return val;
    }
    /**
     * @param {number=} optRadix The radix in which the text should be written.
     * @return {string} The textual representation of this value.
     * @override
     */
    toString(optRadix) {
        let radix = optRadix || 10;
        if (radix < 2 || 36 < radix) {
            throw Error("radix out of range: " + radix);
        }

        if (this.isZero()) {
            return "0";
        } else if (this.isNegative()) {
            return "-" + this.negate().toString(radix);
        }

        // Do several (6) digits each time through the loop, so as to
        // minimize the calls to the very expensive emulated div.
        let radixToPower = Integer.fromNumber(Math.pow(radix, 6));

        let rem = this;
        let result = "";
        while (true) {
            let remDiv = rem.divide(radixToPower);
            let intval = rem.subtract(remDiv.multiply(radixToPower)).toInt();
            let digits = intval.toString(radix);

            rem = remDiv;
            if (rem.isZero()) {
                return digits + result;
            }
            while (digits.length < 6) {
                digits = "0" + digits;
            }
            result = "" + digits + result;
        }
    }
    /**
     * Returns the index-th 32-bit (signed) piece of the Integer according to
     * little-endian order (i.e., index 0 contains the smallest bits).
     * @param {number} index The index in question.
     * @return {number} The requested 32-bits as a signed number.
     */
    getBits(index) {
        if (index < 0) {
            return 0; // Allowing this simplifies bit shifting operations below...
        } else if (index < this.#bits.length) {
            return this.#bits[index];
        }
        return this.#sign;
    }
    /**
     * Returns the index-th 32-bit piece as an unsigned number.
     * @param {number} index The index in question.
     * @return {number} The requested 32-bits as an unsigned number.
     */
    getBitsUnsigned(index) {
        let val = this.getBits(index);
        return val >= 0 ? val : Integer.TWO_PWR_32_DBL_ + val;
    }
    /** @return {number} The sign bit of this number, -1 or 0. */
    getSign() {
        return this.#sign;
    }
    /** @return {boolean} Whether this value is zero. */
    isZero() {
        if (this.#sign != 0) {
            return false;
        }
        for (let i = 0; i < this.#bits.length; i++) {
            if (this.#bits[i] != 0) {
                return false;
            }
        }
        return true;
    }
    /** @return {boolean} Whether this value is negative. */
    isNegative() {
        return this.#sign == -1;
    }
    /** @return {boolean} Whether this value is odd. */
    isOdd() {
        return (
            (this.#bits.length == 0 && this.#sign == -1) ||
            (this.#bits.length > 0 && (this.#bits[0] & 1) != 0)
        );
    }
    /**
     * @param {Integer} other Integer to compare against.
     * @return {boolean} Whether this Integer equals the other.
     */
    equals(other) {
        if (this.#sign != other.#sign) {
            return false;
        }
        let len = Math.max(this.#bits.length, other.#bits.length);
        for (let i = 0; i < len; i++) {
            if (this.getBits(i) != other.getBits(i)) {
                return false;
            }
        }
        return true;
    }
    /**
     * @param {Integer} other Integer to compare against.
     * @return {boolean} Whether this Integer does not equal the other.
     */
    notEquals(other) {
        return !this.equals(other);
    }
    /**
     * @param {Integer} other Integer to compare against.
     * @return {boolean} Whether this Integer is greater than the other.
     */
    greaterThan(other) {
        return this.compare(other) > 0;
    }
    /**
     * @param {Integer} other Integer to compare against.
     * @return {boolean} Whether this Integer is greater than or equal to the other.
     */
    greaterThanOrEqual(other) {
        return this.compare(other) >= 0;
    }
    /**
     * @param {Integer} other Integer to compare against.
     * @return {boolean} Whether this Integer is less than the other.
     */
    lessThan(other) {
        return this.compare(other) < 0;
    }
    /**
     * @param {Integer} other Integer to compare against.
     * @return {boolean} Whether this Integer is less than or equal to the other.
     */
    lessThanOrEqual(other) {
        return this.compare(other) <= 0;
    }
    /**
     * Compares this Integer with the given one.
     * @param {Integer} other Integer to compare against.
     * @return {number} 0 if they are the same, 1 if the this is greater, and -1
     *     if the given one is greater.
     */
    compare(other) {
        let diff = this.subtract(other);
        if (diff.isNegative()) {
            return -1;
        } else if (diff.isZero()) {
            return 0;
        }
        return +1;
    }
    /**
     * Returns an integer with only the first numBits bits of this value, sign
     * extended from the final bit.
     * @param {number} numBits The number of bits by which to shift.
     * @return {!Integer} The shorted integer value.
     */
    shorten(numBits) {
        let arrIndex = (numBits - 1) >> 5;
        let bitIndex = (numBits - 1) % 32;
        let bits = [];
        for (let i = 0; i < arrIndex; i++) {
            bits[i] = this.getBits(i);
        }
        let sigBits = bitIndex == 31 ? 0xffffffff : (1 << (bitIndex + 1)) - 1;
        let val = this.getBits(arrIndex) & sigBits;
        // noinspection JSBitwiseOperatorUsage
        if (val & (1 << bitIndex)) {
            val |= 0xffffffff - sigBits;
            bits[arrIndex] = val;
            return new Integer(bits, -1);
        }
        bits[arrIndex] = val;
        return new Integer(bits, 0);
    }
    /** @return {!Integer} The negation of this value. */
    negate() {
        return this.not().add(Integer.ONE);
    }
    /**
     * Returns the sum of this and the given Integer.
     * @param {Integer} other The Integer to add to this.
     * @return {!Integer} The Integer result.
     */
    add(other) {
        let len = Math.max(this.#bits.length, other.#bits.length);
        let arr = [];
        let carry = 0;

        for (let i = 0; i <= len; i++) {
            let a1 = this.getBits(i) >>> 16;
            let a0 = this.getBits(i) & 0xffff;

            let b1 = other.getBits(i) >>> 16;
            let b0 = other.getBits(i) & 0xffff;

            let c0 = carry + a0 + b0;
            let c1 = (c0 >>> 16) + a1 + b1;
            carry = c1 >>> 16;
            c0 &= 0xffff;
            c1 &= 0xffff;
            arr[i] = (c1 << 16) | c0;
        }
        return Integer.fromBits(arr);
    }
    /**
     * Returns the difference of this and the given Integer.
     * @param {Integer} other The Integer to subtract from this.
     * @return {!Integer} The Integer result.
     */
    subtract(other) {
        return this.add(other.negate());
    }
    /**
     * Returns the product of this and the given Integer.
     * @param {Integer} other The Integer to multiply against this.
     * @return {!Integer} The product of this and the other.
     */
    multiply(other) {
        if (this.isZero()) {
            return Integer.ZERO;
        } else if (other.isZero()) {
            return Integer.ZERO;
        }

        if (this.isNegative()) {
            if (other.isNegative()) {
                return this.negate().multiply(other.negate());
            }
            return this.negate().multiply(other).negate();
        } else if (other.isNegative()) {
            return this.multiply(other.negate()).negate();
        }

        // If both numbers are small, use float multiplication
        if (
            this.lessThan(Integer.TWO_PWR_24_) &&
            other.lessThan(Integer.TWO_PWR_24_)
        ) {
            return Integer.fromNumber(this.toNumber() * other.toNumber());
        }

        // Fill in an array of 16-bit products.
        let len = this.#bits.length + other.#bits.length;
        let arr = [];
        for (let i = 0; i < 2 * len; i++) {
            arr[i] = 0;
        }
        for (let i = 0; i < this.#bits.length; i++) {
            for (let j = 0; j < other.#bits.length; j++) {
                let a1 = this.getBits(i) >>> 16;
                let a0 = this.getBits(i) & 0xffff;

                let b1 = other.getBits(j) >>> 16;
                let b0 = other.getBits(j) & 0xffff;

                arr[2 * i + 2 * j] += a0 * b0;
                Integer.#carry16(arr, 2 * i + 2 * j);
                arr[2 * i + 2 * j + 1] += a1 * b0;
                Integer.#carry16(arr, 2 * i + 2 * j + 1);
                arr[2 * i + 2 * j + 1] += a0 * b1;
                Integer.#carry16(arr, 2 * i + 2 * j + 1);
                arr[2 * i + 2 * j + 2] += a1 * b1;
                Integer.#carry16(arr, 2 * i + 2 * j + 2);
            }
        }

        // Combine the 16-bit values into 32-bit values.
        for (let i = 0; i < len; i++) {
            arr[i] = (arr[2 * i + 1] << 16) | arr[2 * i];
        }
        for (let i = len; i < 2 * len; i++) {
            arr[i] = 0;
        }
        return new Integer(arr, 0);
    }
    /**
     * Returns this Integer divided by the given one.
     * @param {Integer} other Th Integer to divide this by.
     * @return {!Integer} This value divided by the given one.
     */
    divide(other) {
        if (other.isZero()) {
            throw Error("division by zero");
        } else if (this.isZero()) {
            return Integer.ZERO;
        }

        if (this.isNegative()) {
            if (other.isNegative()) {
                return this.negate().divide(other.negate());
            }
            return this.negate().divide(other).negate();
        } else if (other.isNegative()) {
            return this.divide(other.negate()).negate();
        }

        // Repeat the following until the remainder is less than other:  find a
        // floating-point that approximates remainder / other *from below*, add this
        // into the result, and subtract it from the remainder.  It is critical that
        // the approximate value is less than or equal to the real value so that the
        // remainder never becomes negative.
        let res = Integer.ZERO;
        let rem = this;
        while (rem.greaterThanOrEqual(other)) {
            // Approximate the result of division. This may be a little greater or
            // smaller than the actual value.
            let approx = Math.max(
                1,
                Math.floor(rem.toNumber() / other.toNumber()),
            );

            // We will tweak the approximate result by changing it in the 48-th digit or
            // the smallest non-fractional digit, whichever is larger.
            let log2 = Math.ceil(Math.log(approx) / Math.LN2);
            let delta = log2 <= 48 ? 1 : Math.pow(2, log2 - 48);

            // Decrease the approximation until it is smaller than the remainder.  Note
            // that if it is too large, the product overflows and is negative.
            let approxRes = Integer.fromNumber(approx);
            let approxRem = approxRes.multiply(other);
            while (approxRem.isNegative() || approxRem.greaterThan(rem)) {
                approx -= delta;
                approxRes = Integer.fromNumber(approx);
                approxRem = approxRes.multiply(other);
            }

            // We know the answer can't be zero... and actually, zero would cause
            // infinite recursion since we would make no progress.
            if (approxRes.isZero()) {
                approxRes = Integer.ONE;
            }

            res = res.add(approxRes);
            rem = rem.subtract(approxRem);
        }
        return res;
    }
    /**
     * Returns this Integer modulo the given one.
     * @param {Integer} other The Integer by which to mod.
     * @return {!Integer} This value modulo the given one.
     */
    modulo(other) {
        return this.subtract(this.divide(other).multiply(other));
    }
    /** @return {!Integer} The bitwise-NOT of this value. */
    not() {
        let len = this.#bits.length;
        let arr = [];
        for (let i = 0; i < len; i++) {
            arr[i] = ~this.#bits[i];
        }
        return new Integer(arr, ~this.#sign);
    }
    /**
     * Returns the bitwise-AND of this Integer and the given one.
     * @param {Integer} other The Integer to AND with this.
     * @return {!Integer} The bitwise-AND of this and the other.
     */
    and(other) {
        let len = Math.max(this.#bits.length, other.#bits.length);
        let arr = [];
        for (let i = 0; i < len; i++) {
            arr[i] = this.getBits(i) & other.getBits(i);
        }
        return new Integer(arr, this.#sign & other.#sign);
    }
    /**
     * Returns the bitwise-OR of this Integer and the given one.
     * @param {Integer} other The Integer to OR with this.
     * @return {!Integer} The bitwise-OR of this and the other.
     */
    or(other) {
        let len = Math.max(this.#bits.length, other.#bits.length);
        let arr = [];
        for (let i = 0; i < len; i++) {
            arr[i] = this.getBits(i) | other.getBits(i);
        }
        return new Integer(arr, this.#sign | other.#sign);
    }
    /**
     * Returns the bitwise-XOR of this Integer and the given one.
     * @param {Integer} other The Integer to XOR with this.
     * @return {!Integer} The bitwise-XOR of this and the other.
     */
    xor(other) {
        let len = Math.max(this.#bits.length, other.#bits.length);
        let arr = [];
        for (let i = 0; i < len; i++) {
            arr[i] = this.getBits(i) ^ other.getBits(i);
        }
        return new Integer(arr, this.#sign ^ other.#sign);
    }
    /**
     * Returns this value with bits shifted to the left by the given amount.
     * @param {number} numBits The number of bits by which to shift.
     * @return {!Integer} This shifted to the left by the given amount.
     */
    shiftLeft(numBits) {
        let arrDelta = numBits >> 5;
        let bitDelta = numBits % 32;
        let len = this.#bits.length + arrDelta + (bitDelta > 0 ? 1 : 0);
        let arr = [];
        for (let i = 0; i < len; i++) {
            if (bitDelta > 0) {
                arr[i] =
                    (this.getBits(i - arrDelta) << bitDelta) |
                    (this.getBits(i - arrDelta - 1) >>> (32 - bitDelta));
            } else {
                arr[i] = this.getBits(i - arrDelta);
            }
        }
        return new Integer(arr, this.#sign);
    }
    /**
     * Returns this value with bits shifted to the right by the given amount.
     * @param {number} numBits The number of bits by which to shift.
     * @return {!Integer} This shifted to the right by the given amount.
     */
    shiftRight(numBits) {
        let arrDelta = numBits >> 5;
        let bitDelta = numBits % 32;
        let len = this.#bits.length - arrDelta;
        let arr = [];
        for (let i = 0; i < len; i++) {
            if (bitDelta > 0) {
                arr[i] =
                    (this.getBits(i + arrDelta) >>> bitDelta) |
                    (this.getBits(i + arrDelta + 1) << (32 - bitDelta));
            } else {
                arr[i] = this.getBits(i + arrDelta);
            }
        }
        return new Integer(arr, this.#sign);
    }
    /**
     * Provide the name of the constructor and the string representation
     * @returns {string}
     */
    inspect() {
        return this.constructor.name + ": " + this.toString();
    }
    /**
     * Returns a Integer whose value is the absolute value of this
     * @returns {Integer}
     */
    abs() {
        return this.#sign === 0 ? this : this.negate();
    }
    /**
     * Returns the string representation.
     * Method used by the native JSON.stringify() to serialize this instance.
     */
    toJSON() {
        return this.toString();
    }
}

// NOTE: Common constant values ZERO, ONE, NEG_ONE, etc. are defined below the
// from* methods on which they depend.

/**
 * A cache of the Integer representations of small integer values.
 * @type {!Object}
 * @private
 */
Integer.IntCache_ = {};

/**
 * A number used repeatedly in calculations.  This must appear before the first
 * call to the from* functions below.
 * @type {number}
 * @private
 */
Integer.TWO_PWR_32_DBL_ = (1 << 16) * (1 << 16);

/** @type {!Integer} */
Integer.ZERO = Integer.fromInt(0);

/** @type {!Integer} */
Integer.ONE = Integer.fromInt(1);

/**
 * @type {!Integer}
 * @private
 */
Integer.TWO_PWR_24_ = Integer.fromInt(1 << 24);

module.exports = Integer;
