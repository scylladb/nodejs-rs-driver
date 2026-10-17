"use strict";

// Edge cases for the types that the Encoder writes straight into the values frame.
// test/unit/fixtures/encoder-bytes.json holds the bytes and errors for each case,
// as the Encoder gave them before it wrote any type into the frame.
// Thus, the tests catch any change of the encoding when a type moves to a writer.

const Encoder = require("../../../lib/encoder");
const types = require("../../../lib/types");

const { dataTypes, Long, Uuid, TimeUuid } = types;
const t = (code, info) => ({ code, info });

const int = t(dataTypes.int);
const text = t(dataTypes.text);
const bigint = t(dataTypes.bigint);
const timestamp = t(dataTypes.timestamp);
const uuidString = "a3e4c8b2-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

/** The encoders that the cases use, by name. */
function makeEncoders() {
    return {
        default: new Encoder(4, {}),
        bigint: new Encoder(4, { encoding: { useBigIntAsLong: true } }),
        v2: new Encoder(2, {}),
        setMap: new Encoder(4, { encoding: { set: Set, map: Map } }),
    };
}

/**
 * Each case: [unique label, encoder name, type, value].
 * The value is a function, because some values are objects that a test could change.
 */
const cases = [
    // int
    ["int 0", "default", int, () => 0],
    ["int -1", "default", int, () => -1],
    ["int max", "default", int, () => 2147483647],
    ["int min", "default", int, () => -2147483648],
    ["int fraction", "default", int, () => 1.9],
    ["int numeric string", "default", int, () => "12"],
    ["int true", "default", int, () => true],
    ["int too large", "default", int, () => 2147483648],
    ["int NaN", "default", int, () => NaN],
    ["int bad string", "default", int, () => "x"],
    ["int object", "default", int, () => ({})],

    // double
    ["double 1.5", "default", t(dataTypes.double), () => 1.5],
    ["double -0", "default", t(dataTypes.double), () => -0],
    ["double NaN", "default", t(dataTypes.double), () => NaN],
    ["double Infinity", "default", t(dataTypes.double), () => Infinity],
    ["double numeric string", "default", t(dataTypes.double), () => "2.5"],
    ["double bad string", "default", t(dataTypes.double), () => "abc"],
    ["double boolean", "default", t(dataTypes.double), () => true],

    // boolean
    ["boolean true", "default", t(dataTypes.boolean), () => true],
    ["boolean false", "default", t(dataTypes.boolean), () => false],
    ["boolean 0", "default", t(dataTypes.boolean), () => 0],
    ["boolean string", "default", t(dataTypes.boolean), () => "x"],
    ["boolean empty string", "default", t(dataTypes.boolean), () => ""],
    ["boolean object", "default", t(dataTypes.boolean), () => ({})],

    // text, varchar, ascii
    ["text plain", "default", text, () => "plain"],
    ["text empty", "default", text, () => ""],
    ["text non-ASCII", "default", text, () => "zażółć 😀 \u0000"],
    ["text lone surrogate", "default", text, () => "a\ud800b"],
    ["text long", "default", text, () => "ł".repeat(3000)],
    ["text number", "default", text, () => 5],
    ["text object", "default", text, () => ({})],
    ["varchar plain", "default", t(dataTypes.varchar), () => "v"],
    ["ascii plain", "default", t(dataTypes.ascii), () => "abc"],
    ["ascii non-ASCII", "default", t(dataTypes.ascii), () => "zaż"],
    ["ascii long", "default", t(dataTypes.ascii), () => "a".repeat(3000)],
    ["ascii number", "default", t(dataTypes.ascii), () => 5],

    // bigint and counter, with Long
    ["bigint Long 0", "default", bigint, () => Long.ZERO],
    ["bigint Long -1", "default", bigint, () => Long.NEG_ONE],
    ["bigint Long max", "default", bigint, () => Long.MAX_VALUE],
    ["bigint Long min", "default", bigint, () => Long.MIN_VALUE],
    ["bigint Long number", "default", bigint, () => 7],
    ["bigint Long negative number", "default", bigint, () => -7],
    ["bigint Long string", "default", bigint, () => "123"],
    ["bigint Long bad string", "default", bigint, () => "abc"],
    ["bigint Long exponent string", "default", bigint, () => "1e3"],
    ["bigint Long empty string", "default", bigint, () => ""],
    ["bigint Long BigInt", "default", bigint, () => 5n],
    ["bigint Long object", "default", bigint, () => ({})],
    ["counter Long", "default", t(dataTypes.counter), () => Long.fromNumber(5)],

    // bigint and counter, with BigInt
    ["bigint BigInt 0", "bigint", bigint, () => 0n],
    ["bigint BigInt -1", "bigint", bigint, () => -1n],
    ["bigint BigInt max", "bigint", bigint, () => 2n ** 63n - 1n],
    ["bigint BigInt min", "bigint", bigint, () => -(2n ** 63n)],
    ["bigint BigInt too large", "bigint", bigint, () => 2n ** 64n + 5n],
    ["bigint BigInt string", "bigint", bigint, () => "7"],
    ["bigint BigInt bad string", "bigint", bigint, () => "abc"],
    ["bigint BigInt number", "bigint", bigint, () => 5],
    ["bigint BigInt Long", "bigint", bigint, () => Long.ONE],
    ["counter BigInt", "bigint", t(dataTypes.counter), () => 5n],

    // timestamp
    ["timestamp epoch", "default", timestamp, () => new Date(0)],
    ["timestamp -1", "default", timestamp, () => new Date(-1)],
    ["timestamp recent", "default", timestamp, () => new Date(1700000000123)],
    ["timestamp max", "default", timestamp, () => new Date(8.64e15)],
    ["timestamp min", "default", timestamp, () => new Date(-8.64e15)],
    ["timestamp number", "default", timestamp, () => 1234],
    ["timestamp string", "default", timestamp, () => "2020-01-01T00:00:00Z"],
    ["timestamp Long", "default", timestamp, () => Long.fromNumber(99)],
    ["timestamp invalid Date", "default", timestamp, () => new Date(NaN)],
    ["timestamp bad string", "default", timestamp, () => "not a date"],
    ["timestamp object", "default", timestamp, () => ({})],
    ["timestamp BigInt mode Date", "bigint", timestamp, () => new Date(-5)],
    ["timestamp BigInt mode number", "bigint", timestamp, () => 123],
    ["timestamp BigInt mode BigInt", "bigint", timestamp, () => 77n],
    ["timestamp BigInt mode fraction", "bigint", timestamp, () => 1.5],

    // uuid and timeuuid
    [
        "uuid Uuid",
        "default",
        t(dataTypes.uuid),
        () => Uuid.fromString(uuidString),
    ],
    ["uuid string", "default", t(dataTypes.uuid), () => uuidString],
    ["uuid bad string", "default", t(dataTypes.uuid), () => "not a uuid"],
    ["uuid number", "default", t(dataTypes.uuid), () => 5],
    [
        "timeuuid TimeUuid",
        "default",
        t(dataTypes.timeuuid),
        () => TimeUuid.fromDate(new Date(0), 0, "abcdef", "ab"),
    ],
    ["timeuuid string", "default", t(dataTypes.timeuuid), () => uuidString],

    // list and set
    ["list int", "default", t(dataTypes.list, int), () => [1, 2]],
    ["list empty", "default", t(dataTypes.list, int), () => []],
    ["list text", "default", t(dataTypes.list, text), () => ["a", "bb"]],
    ["list mixed", "default", t(dataTypes.list, int), () => [1, "2"]],
    [
        "list of lists",
        "default",
        t(dataTypes.list, t(dataTypes.list, int)),
        () => [[1], [2, 3]],
    ],
    ["list null item", "default", t(dataTypes.list, int), () => [1, null]],
    [
        "list undefined item",
        "default",
        t(dataTypes.list, int),
        () => [1, undefined],
    ],
    ["list unset item", "default", t(dataTypes.list, int), () => [types.unset]],
    [
        "list Buffer item",
        "default",
        t(dataTypes.list, t(dataTypes.boolean)),
        () => [Buffer.from([0])],
    ],
    ["list bad item", "default", t(dataTypes.list, int), () => ["x"]],
    ["list not array", "default", t(dataTypes.list, int), () => "abc"],
    ["set int", "default", t(dataTypes.set, int), () => [3, 4]],
    ["set empty", "default", t(dataTypes.set, int), () => []],
    ["set Set object", "default", t(dataTypes.set, int), () => new Set([1])],

    // map
    [
        "map text int",
        "default",
        t(dataTypes.map, [text, int]),
        () => ({ a: 1, b: 2 }),
    ],
    ["map empty", "default", t(dataTypes.map, [text, int]), () => ({})],
    [
        "map Map object",
        "default",
        t(dataTypes.map, [text, int]),
        () => new Map([["a", 1]]),
    ],
    [
        "map int keys",
        "default",
        t(dataTypes.map, [int, text]),
        () => new Map([[1, "x"]]),
    ],
    [
        "map nested",
        "default",
        t(dataTypes.map, [text, t(dataTypes.list, text)]),
        () => ({ k: ["x"] }),
    ],
    [
        "map null value",
        "default",
        t(dataTypes.map, [text, int]),
        () => ({ a: null }),
    ],
    [
        "map unset value",
        "default",
        t(dataTypes.map, [text, int]),
        () => ({ a: types.unset }),
    ],
    [
        "map undefined value",
        "default",
        t(dataTypes.map, [text, int]),
        () => ({ a: undefined }),
    ],
    [
        "map Buffer value",
        "default",
        t(dataTypes.map, [text, t(dataTypes.boolean)]),
        () => ({ a: Buffer.from([0]) }),
    ],
    [
        "map bad value",
        "default",
        t(dataTypes.map, [text, int]),
        () => ({ a: "x" }),
    ],
    [
        "map inherited key",
        "default",
        t(dataTypes.map, [text, int]),
        () => Object.assign(Object.create({ inherited: 1 }), { own: 2 }),
    ],
    [
        "map null prototype",
        "default",
        t(dataTypes.map, [text, int]),
        () => Object.assign(Object.create(null), { a: 1 }),
    ],

    // More collection edge cases
    ["list no subtype", "default", t(dataTypes.list), () => [1, "x"]],
    ["list sparse", "default", t(dataTypes.list, int), () => [1, , 3]],
    [
        "list of empty list",
        "default",
        t(dataTypes.list, t(dataTypes.list, int)),
        () => [[]],
    ],
    [
        "set of empty set",
        "default",
        t(dataTypes.set, t(dataTypes.set, int)),
        () => [[]],
    ],
    ["list no subtype of empty list", "default", t(dataTypes.list), () => [[]]],
    [
        "set Set object with option",
        "setMap",
        t(dataTypes.set, int),
        () => new Set([5, 6]),
    ],
    [
        "set Set object null item",
        "setMap",
        t(dataTypes.set, int),
        () => new Set([null]),
    ],
    ["map no subtypes", "default", t(dataTypes.map), () => ({ a: 1 })],
    [
        "map value empty list",
        "default",
        t(dataTypes.map, [text, t(dataTypes.list, int)]),
        () => ({ a: [] }),
    ],
    [
        "map key empty list",
        "setMap",
        t(dataTypes.map, [t(dataTypes.list, int), int]),
        () => new Map([[[], 1]]),
    ],
    [
        "map Map object with option",
        "setMap",
        t(dataTypes.map, [text, int]),
        () => new Map([["k", 5]]),
    ],
    [
        "map Map object null key",
        "setMap",
        t(dataTypes.map, [text, int]),
        () => new Map([[null, 5]]),
    ],
    [
        "map Map object unset value",
        "setMap",
        t(dataTypes.map, [text, int]),
        () => new Map([["k", types.unset]]),
    ],
];

/**
 * Encodes the value of a case with `encode`.
 * @returns `{ hex }`, or `{ error: [class name, message] }`
 */
function encodeCase(encoders, [, encoderName, type, value]) {
    try {
        const bytes = encoders[encoderName].encode(value(), type);
        return { hex: bytes === null ? null : bytes.toString("hex") };
    } catch (err) {
        return { error: [err.constructor.name, err.message] };
    }
}

module.exports = { cases, makeEncoders, encodeCase };
