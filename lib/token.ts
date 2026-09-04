"use strict";

import types = require("./types");
import util = require("util");
import rust = require("../index");

/**
 * The type info of the value of a token.
 */
type TokenType = { code: types.dataTypes.bigint; info: any };

/**
 * Lowest value of the ring: not a valid token, but the exclusive start of the ring.
 */
const _minValue = BigInt("-9223372036854775808");
/**
 * Highest value of the ring, and its inclusive end.
 */
const _maxValue = BigInt("9223372036854775807");
/**
 * Number of values the ring spans, used to wrap around its end.
 */
const _ringLength = _maxValue - _minValue;
const _zero = BigInt(0);
const _one = BigInt(1);

/**
 * Represents a token on the Cassandra ring.
 */
class Token {
    #value: bigint;

    constructor(value: bigint) {
        this.#value = value;
    }

    /**
     * Returns the type info for the type of the value of the token.
     */
    getType(): TokenType {
        return { code: types.dataTypes.bigint, info: null };
    }

    /**
     * Returns the raw value of the token.
     */
    getValue(): bigint {
        return this.#value;
    }

    toString(): string {
        return this.#value.toString();
    }

    /**
     * Returns 0 if the values are equal, 1 if greater than other, -1
     * otherwise.
     */
    compare(other: Token): number {
        const otherValue = other.getValue();
        if (this.getValue() < otherValue) {
            return -1;
        }
        return this.getValue() > otherValue ? 1 : 0;
    }

    equals(other: Token): boolean {
        return this.compare(other) === 0;
    }

    inspect(): string {
        return this.constructor.name + " { " + this.toString() + " }";
    }
}

/**
 * The token the ring starts at, exclusively, and ends at, inclusively: the range
 * ]minToken, minToken] covers the whole ring.
 */
const _minToken = new Token(_minValue);

/**
 * Splits the range ]start, end] into `numberOfSplits` parts of equal "size" (referring to the
 * number of tokens, not the actual amount of data), returning the tokens the parts are split at.
 *
 * @param start Starting token.
 * @param end End token.
 * @param numberOfSplits Number of splits to make.
 * @returns The `numberOfSplits - 1` points the range is split at.
 */
function _split(start: Token, end: Token, numberOfSplits: number): Token[] {
    // The ring is spanned by 64 bit signed integers, whatever a token carries its value as.
    const startValue: bigint = start.getValue();
    // ]minToken, minToken] means the whole ring, which ends at the highest value of the ring.
    const endValue: bigint =
        start.equals(end) && start.equals(_minToken)
            ? _maxValue
            : end.getValue();

    let range = endValue - startValue;
    if (range < _zero) {
        // The range wraps around the end of the ring.
        range += _ringLength;
    }

    const splits = BigInt(numberOfSplits);
    const divider = range / splits;
    // The first `remainder` splits are one token larger, so that the splits add up to the range.
    let remainder = range % splits;

    const splitPoints: Token[] = [];
    let current = startValue;
    for (let i = 1; i < numberOfSplits; i++) {
        current += remainder > _zero ? divider + _one : divider;
        if (current > _maxValue) {
            current -= _ringLength;
        }
        splitPoints.push(new Token(current));
        remainder -= _one;
    }
    return splitPoints;
}

/**
 * Represents a range of tokens on a Cassandra ring.
 *
 * A range is start-exclusive and end-inclusive.  It is empty when
 * start and end are the same token, except if that is the minimum
 * token, in which case the range covers the whole ring (this is
 * consistent with the behavior of CQL range queries).
 *
 * Note that CQL does not handle wrapping.  To query all partitions
 * in a range, see {@link unwrap}.
 */
class TokenRange {
    start: Token;
    end: Token;

    constructor(start: Token, end: Token) {
        this.start = start;
        this.end = end;
    }

    /**
     * Splits this range into a number of smaller ranges of equal "size"
     * (referring to the number of tokens, not the actual amount of data).
     *
     * Splitting an empty range is not permitted.  But not that, in edge
     * cases, splitting a range might produce one or more empty ranges.
     *
     * @param numberOfSplits Number of splits to make.
     * @returns Split ranges.
     * @throws {Error} If splitting an empty range.
     */
    splitEvenly(numberOfSplits: number): TokenRange[] {
        if (numberOfSplits < 1) {
            throw new Error(
                util.format(
                    "numberOfSplits (%d) must be greater than 0.",
                    numberOfSplits,
                ),
            );
        }
        if (this.isEmpty()) {
            throw new Error("Can't split empty range " + this.toString());
        }

        const tokenRanges: TokenRange[] = [];
        const splitPoints = _split(this.start, this.end, numberOfSplits);
        let splitStart = this.start;
        let splitEnd;
        for (
            let splitIndex = 0;
            splitIndex < splitPoints.length;
            splitIndex++
        ) {
            splitEnd = splitPoints[splitIndex];
            tokenRanges.push(new TokenRange(splitStart, splitEnd));
            splitStart = splitEnd;
        }
        tokenRanges.push(new TokenRange(splitStart, this.end));
        return tokenRanges;
    }

    /**
     * A range is empty when start and end are the same token, except if
     * that is the minimum token, in which case the range covers the
     * whole ring.  This is consistent with the behavior of CQL range
     * queries.
     *
     * @returns Whether this range is empty.
     */
    isEmpty(): boolean {
        return this.start.equals(this.end) && !this.start.equals(_minToken);
    }

    /**
     * A range wraps around the end of the ring when the start token
     * is greater than the end token and the end token is not the
     * minimum token.
     *
     * @returns Whether this range wraps around.
     */
    isWrappedAround(): boolean {
        return this.start.compare(this.end) > 0 && !this.end.equals(_minToken);
    }

    /**
     * Splits this range into a list of two non-wrapping ranges.
     *
     * This will return the range itself if it is non-wrapped, or two
     * ranges otherwise.
     *
     * This is useful for CQL range queries, which do not handle
     * wrapping.
     *
     * @returns The list of non-wrapping ranges.
     */
    unwrap(): TokenRange[] {
        if (this.isWrappedAround()) {
            return [
                new TokenRange(this.start, _minToken),
                new TokenRange(_minToken, this.end),
            ];
        }
        return [this];
    }

    /**
     * Whether this range contains a given Token.
     *
     * @param token Token to check for.
     * @returns Whether or not the Token is in this range.
     */
    contains(token: Token): boolean {
        if (this.isEmpty()) {
            return false;
        }
        if (this.end.equals(_minToken)) {
            if (this.start.equals(_minToken)) {
                return true; // ]minToken, minToken] === full ring
            } else if (token.equals(_minToken)) {
                return true;
            }
            return token.compare(this.start) > 0;
        }

        const isAfterStart = token.compare(this.start) > 0;
        const isBeforeEnd = token.compare(this.end) <= 0;
        // if wrapped around ring, token is in ring if its after start or before end.
        // otherwise, token is in ring if its after start and before end.
        return this.isWrappedAround()
            ? isAfterStart || isBeforeEnd
            : isAfterStart && isBeforeEnd;
    }

    /**
     * Determines if the input range is equivalent to this one.
     *
     * @param other Range to compare with.
     * @returns Whether or not the ranges are equal.
     */
    equals(other: unknown): boolean {
        if (other === this) {
            return true;
        } else if (other instanceof TokenRange) {
            return this.compare(other) === 0;
        }
        return false;
    }

    /**
     * Returns 0 if the values are equal, otherwise compares against
     * start, if start is equal, compares against end.
     *
     * @param other Range to compare with.
     */
    compare(other: TokenRange): number {
        const compareStart = this.start.compare(other.start);
        return compareStart !== 0 ? compareStart : this.end.compare(other.end);
    }

    toString(): string {
        return util.format(
            "]%s, %s]",
            this.start.toString(),
            this.end.toString(),
        );
    }
}

function minTokenRange(): TokenRange {
    return new TokenRange(_minToken, _minToken);
}

export { Token, TokenRange, minTokenRange };

// Registers the Token constructor, so that Rust can hand back already-parsed tokens as
// real Token instances directly.
rust.registerTokenCtor(Token);
