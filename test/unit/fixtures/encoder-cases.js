"use strict";

// Edge cases of the Encoder, for each type.
// test/unit/fixtures/encoder-bytes.json holds the bytes or the error that the Encoder
// gives for each case. Thus, the tests catch any change of an encoding.
// After you add a case, run `npm run build:ts`, and then
// `node scripts/generate-encoder-bytes.js --write`.

const Encoder = require("../../../lib/encoder");

/** The encoders that the cases use, by name. */
function makeEncoders() {
    return {
        default: new Encoder(4, {}),
    };
}

/**
 * Each case: [unique label, encoder name, type, value].
 * The value is a function, because some values are objects that a test could change.
 */
const cases = [];

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
