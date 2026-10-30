"use strict";

// Edge cases of the Encoder, for each type.
// test/unit/fixtures/encoder-bytes.json holds the bytes or the error that the Encoder
// gives for each case. Thus, the tests catch any change of an encoding.
// After you add a case, run `npm run build:ts`, and then
// `node scripts/generate-encoder-bytes.js --write`.

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
        undefinedAsUnset: new Encoder(4, {
            encoding: { useUndefinedAsUnset: true },
        }),
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
    ["int null", "default", int, () => null],
    ["int unset", "default", int, () => types.unset],
    ["int undefined as unset", "undefinedAsUnset", int, () => undefined],

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

    // blob
    ["blob Buffer", "default", t(dataTypes.blob), () => Buffer.from([1, 2, 3])],
    ["blob empty Buffer", "default", t(dataTypes.blob), () => Buffer.alloc(0)],
    [
        "blob Uint8Array",
        "default",
        t(dataTypes.blob),
        () => new Uint8Array([1, 2]),
    ],
    ["blob string", "default", t(dataTypes.blob), () => "abc"],
    ["blob number", "default", t(dataTypes.blob), () => 5],
    ["blob array", "default", t(dataTypes.blob), () => [1, 2]],
    [
        "list of blobs",
        "default",
        t(dataTypes.list, t(dataTypes.blob)),
        () => [Buffer.from([1]), Buffer.alloc(0)],
    ],
    [
        "list with a bad blob",
        "default",
        t(dataTypes.list, t(dataTypes.blob)),
        () => ["abc"],
    ],

    // a type code without an encoding
    ["unknown type code", "default", t(999), () => 1],

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

    // float, smallint, tinyint and inet
    ["float 1.5", "default", t(dataTypes.float), () => 1.5],
    ["float rounded", "default", t(dataTypes.float), () => 0.1],
    ["float NaN", "default", t(dataTypes.float), () => NaN],
    ["float numeric string", "default", t(dataTypes.float), () => "2.5"],
    ["float bad string", "default", t(dataTypes.float), () => "abc"],
    ["float boolean", "default", t(dataTypes.float), () => true],
    ["smallint -1", "default", t(dataTypes.smallint), () => -1],
    ["smallint numeric string", "default", t(dataTypes.smallint), () => "12"],
    ["smallint too large", "default", t(dataTypes.smallint), () => 40000],
    ["smallint NaN", "default", t(dataTypes.smallint), () => NaN],
    ["tinyint -1", "default", t(dataTypes.tinyint), () => -1],
    ["tinyint fraction", "default", t(dataTypes.tinyint), () => 1.9],
    ["tinyint too large", "default", t(dataTypes.tinyint), () => 200],
    ["tinyint bad string", "default", t(dataTypes.tinyint), () => "x"],
    [
        "inet IPv4",
        "default",
        t(dataTypes.inet),
        () => types.InetAddress.fromString("10.0.0.1"),
    ],
    [
        "inet IPv6",
        "default",
        t(dataTypes.inet),
        () => types.InetAddress.fromString("::1"),
    ],
    ["inet string", "default", t(dataTypes.inet), () => "192.168.1.2"],
    ["inet bad string", "default", t(dataTypes.inet), () => "not an address"],
    ["inet number", "default", t(dataTypes.inet), () => 5],
];

/**
 * Encodes the value of a case with `encode`.
 * @returns `{ hex }`, with `hex: null` for a null value, `{ unset: true }` for an unset value,
 * or `{ error: [class name, message] }`
 */
function encodeCase(encoders, [, encoderName, type, value]) {
    try {
        const bytes = encoders[encoderName].encode(value(), type);
        // encode gives undefined for an unset value.
        if (bytes === undefined) {
            return { unset: true };
        }
        return { hex: bytes === null ? null : bytes.toString("hex") };
    } catch (err) {
        return { error: [err.constructor.name, err.message] };
    }
}

module.exports = { cases, makeEncoders, encodeCase };
