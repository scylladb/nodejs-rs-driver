"use strict";

const token = require("../../lib/token");
const assert = require("assert");

/**
 * Builds a Token from the decimal string representation Cassandra reports, mirroring what a
 * server-reported token string looks like without needing a tokenizer to parse it.
 */
function parse(value) {
    return new token.Token(BigInt(value));
}

const minToken = parse("-9223372036854775808");

function rangeSplitTester(start, end, numberOfSplits, expectedRanges) {
    return () => {
        const range = new token.TokenRange(parse(start), parse(end));
        const splits = range.splitEvenly(numberOfSplits);
        assert.strictEqual(splits.length, numberOfSplits);
        expectedRanges.forEach((split, index) => {
            const eRange = new token.TokenRange(
                parse(split[0]),
                parse(split[1]),
            );
            assert.deepEqual(splits[index], eRange);
            // validate equals method
            assert.ok(splits[index].equals(eRange));
        });
    };
}

describe("TokenRange", () => {
    describe("#splitEvenly()", () => {
        it(
            "should split range",
            rangeSplitTester("-9223372036854775808", "4611686018427387904", 3, [
                ["-9223372036854775808", "-4611686018427387904"],
                ["-4611686018427387904", "0"],
                ["0", "4611686018427387904"],
            ]),
        );
        it(
            "should split range that wraps around the ring",
            rangeSplitTester("4611686018427387904", "0", 3, [
                ["4611686018427387904", "-9223372036854775807"],
                ["-9223372036854775807", "-4611686018427387903"],
                ["-4611686018427387903", "0"],
            ]),
        );
        it(
            "should split range when division not integral",
            rangeSplitTester("0", "11", 3, [
                ["0", "4"],
                ["4", "8"],
                ["8", "11"],
            ]),
        );
        it(
            "should split range producing empty splits",
            rangeSplitTester("0", "2", 5, [
                ["0", "1"],
                ["1", "2"],
                ["2", "2"],
                ["2", "2"],
                ["2", "2"],
            ]),
        );
        it(
            "should split range producing empty splits near ring end",
            rangeSplitTester("9223372036854775807", "-9223372036854775808", 3, [
                ["9223372036854775807", "9223372036854775807"],
                ["9223372036854775807", "9223372036854775807"],
                ["9223372036854775807", "-9223372036854775808"],
            ]),
        );
        it(
            "should split whole ring using minToken",
            rangeSplitTester(
                "-9223372036854775808",
                "-9223372036854775808",
                3,
                [
                    ["-9223372036854775808", "-3074457345618258603"],
                    ["-3074457345618258603", "3074457345618258602"],
                    ["3074457345618258602", "-9223372036854775808"],
                ],
            ),
        );
    });
    describe("#compare()", () => {
        const token0 = parse("0");
        const token1 = parse("-4611686018427387903");
        const token2 = parse("-4611686018427387902");
        const range1 = new token.TokenRange(token1, token0);
        const range2 = new token.TokenRange(token2, token0);
        const range3 = new token.TokenRange(token0, token1);
        const range4 = new token.TokenRange(token0, token2);
        it("should return -1 if start less than other.start", () => {
            assert.strictEqual(range1.compare(range2), -1);
        });
        it("should return 1 if start greater than other.start", () => {
            assert.strictEqual(range2.compare(range1), 1);
        });
        it("should return -1 if start the same and end less than other.end", () => {
            assert.strictEqual(range3.compare(range4), -1);
        });
        it("should return 1 if start the same and end greater than other.end", () => {
            assert.strictEqual(range4.compare(range3), 1);
        });
        it("should return 0 if start and end the same", () => {
            assert.strictEqual(range1.compare(range1), 0);
        });
    });
    const token0 = parse("4611686018427387904");
    const token1 = parse("4611686018427387906");
    describe("#isEmpty()", () => {
        it("should return true when start === end", () => {
            const range = new token.TokenRange(token0, token0);
            assert.strictEqual(range.isEmpty(), true);
        });
        it("should return true when start !== end", () => {
            const range = new token.TokenRange(token0, token1);
            assert.strictEqual(range.isEmpty(), false);
        });
        it("should return false when start and end are minToken", () => {
            const range = new token.TokenRange(minToken, minToken);
            assert.strictEqual(range.isEmpty(), false);
        });
    });
    describe("#isWrappedAround()", () => {
        it("should return true if start > end", () => {
            const range = new token.TokenRange(token1, token0);
            assert.strictEqual(range.isWrappedAround(), true);
        });
        it("should return false if start === end", () => {
            const range = new token.TokenRange(token0, token0);
            assert.strictEqual(range.isWrappedAround(), false);
        });
        it("should return false if start < end", () => {
            const range = new token.TokenRange(token0, token1);
            assert.strictEqual(range.isWrappedAround(), false);
        });
        it("should return false if start > end, end is minToken", () => {
            const range = new token.TokenRange(token0, minToken);
            assert.strictEqual(range.isWrappedAround(), false);
        });
    });
    describe("#unwrap()", () => {
        it("should return input range is not wrapped around ring", () => {
            const range = new token.TokenRange(token0, token1);
            const unwrapped = range.unwrap();
            assert.strictEqual(unwrapped.length, 1);
            assert.strictEqual(unwrapped[0], range);
        });
        it("should return two ranges when range is wrapped around ring", () => {
            const range = new token.TokenRange(token1, token0);
            const unwrapped = range.unwrap();
            assert.strictEqual(unwrapped.length, 2);
            // should be split into two ranges of ]token1,minToken] and ]minToken,token0]
            const expectedRange0 = new token.TokenRange(token1, minToken);
            const expectedRange1 = new token.TokenRange(minToken, token0);
            assert.deepEqual(unwrapped[0], expectedRange0);
            assert.deepEqual(unwrapped[1], expectedRange1);
        });
    });
    describe("#contains()", () => {
        it("should return false if range is empty", () => {
            const range = new token.TokenRange(token0, token0);
            assert.strictEqual(range.contains(token1), false);
        });
        it("should return true is range covers entire ring", () => {
            const range = new token.TokenRange(minToken, minToken);
            assert.strictEqual(range.contains(token1), true);
            assert.strictEqual(range.contains(token0), true);
            assert.strictEqual(range.contains(minToken), true);
        });
        it("should return true if > start and end is minToken", () => {
            const range = new token.TokenRange(token0, minToken);
            assert.strictEqual(range.contains(token1), true);
            assert.strictEqual(range.contains(minToken), true);
        });
        it("should return false if === start and end is minToken", () => {
            const range = new token.TokenRange(token0, minToken);
            assert.strictEqual(range.contains(token0), false);
        });
        it("should return false if < start and end is minToken", () => {
            const range = new token.TokenRange(token1, minToken);
            assert.strictEqual(range.contains(token0), false);
        });
        it("should return false if === start", () => {
            const range = new token.TokenRange(token0, token1);
            assert.strictEqual(range.contains(token0), false);
        });
        describe("when range is not wrapped around the ring", () => {
            it("should return false if < start", () => {
                const range = new token.TokenRange(token1, minToken);
                assert.strictEqual(range.contains(token0), false);
            });
            it("should return true if > start and < end", () => {
                const range = new token.TokenRange(token0, token1);
                const middleToken = parse("4611686018427387905");
                assert.strictEqual(range.contains(middleToken), true);
            });
        });
        describe("when range is wrapped around the ring", () => {
            it("should return true if > start", () => {
                const range = new token.TokenRange(token0, minToken);
                assert.strictEqual(range.contains(token1), true);
            });
            it("should return true if < start and end", () => {
                const range = new token.TokenRange(token1, token0);
                assert.strictEqual(range.contains(minToken), true);
            });
            it("should return false if < start and > end", () => {
                const range = new token.TokenRange(token1, token0);
                const middleToken = parse("4611686018427387905");
                assert.strictEqual(range.contains(middleToken), false);
            });
        });
    });
    describe("#equals()", () => {
        it("should return true if same object", () => {
            const range = new token.TokenRange(token1, token0);
            assert.strictEqual(range.equals(range), true);
        });
        it("should return true if start and end are equal with other range", () => {
            const range0 = new token.TokenRange(token1, token0);
            const range1 = new token.TokenRange(token1, token0);
            assert.strictEqual(range0.equals(range1), true);
        });
        it("should return false if start and end are not equal with other range", () => {
            const range0 = new token.TokenRange(token0, token1);
            const range1 = new token.TokenRange(token1, token0);
            assert.strictEqual(range0.equals(range1), false);
        });
    });
    describe("#toString()", () => {
        it("should produce in format of ]start,end]", () => {
            const range0 = new token.TokenRange(token0, token1);
            assert.strictEqual(
                range0.toString(),
                "]4611686018427387904, 4611686018427387906]",
            );
        });
    });
});

describe("Token", () => {
    describe("#compare()", () => {
        it("should return -1 when less than other", () => {
            assert.strictEqual(parse("0").compare(parse("1")), -1);
        });
        it("should return 1 when greater than other", () => {
            assert.strictEqual(parse("1").compare(parse("0")), 1);
        });
        it("should return 0 when equal to other", () => {
            assert.strictEqual(parse("1").compare(parse("1")), 0);
        });
    });
    describe("#equals()", () => {
        it("should return true when the values are equal", () => {
            assert.strictEqual(parse("1").equals(parse("1")), true);
        });
        it("should return false when the values are not equal", () => {
            assert.strictEqual(parse("1").equals(parse("2")), false);
        });
    });
    describe("#getValue()", () => {
        it("should return the token's value as a bigint", () => {
            assert.strictEqual(parse("1").getValue(), 1n);
        });
    });
    describe("#toString()", () => {
        it("should return the decimal representation of the value", () => {
            assert.strictEqual(parse("-123").toString(), "-123");
        });
    });
});
