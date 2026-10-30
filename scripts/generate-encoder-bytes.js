"use strict";

// Generates test/unit/fixtures/encoder-bytes.json: the bytes or the error that the Encoder
// gives for each case of test/unit/fixtures/encoder-cases.js.
// It uses the compiled Encoder. Thus, run `npm run build:ts` first.
//
// Usage: node scripts/generate-encoder-bytes.js [--write]
// It prints each case that is new, changed or removed. With --write, it also writes the file.
// A changed case means that an encoding changed. Thus, write the file only to add cases,
// or when a change of an encoding is intended.

const fs = require("fs");
const path = require("path");
const prettier = require("prettier");
const {
    cases,
    makeEncoders,
    encodeCase,
} = require("../test/unit/fixtures/encoder-cases");

const file = path.join(
    __dirname,
    "..",
    "test",
    "unit",
    "fixtures",
    "encoder-bytes.json",
);

async function main() {
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    const encoders = makeEncoders();
    const result = {};
    for (const c of cases) {
        const label = c[0];
        if (Object.hasOwn(result, label)) {
            throw new Error("Two cases have the label " + label);
        }
        result[label] = encodeCase(encoders, c);
    }

    let changes = 0;
    for (const [label, now] of Object.entries(result)) {
        const text = JSON.stringify(now);
        if (!Object.hasOwn(old, label)) {
            console.log(`new:     ${label}  ${text}`);
            changes++;
        } else if (JSON.stringify(old[label]) !== text) {
            console.log(
                `changed: ${label}  ${JSON.stringify(old[label])}  ->  ${text}`,
            );
            changes++;
        }
    }
    for (const label of Object.keys(old)) {
        if (!Object.hasOwn(result, label)) {
            console.log(`removed: ${label}`);
            changes++;
        }
    }
    console.log(`${changes} change(s), ${cases.length} cases`);

    if (process.argv.includes("--write")) {
        const options = await prettier.resolveConfig(file);
        const text = await prettier.format(JSON.stringify(result), {
            ...options,
            filepath: file,
        });
        fs.writeFileSync(file, text);
        console.log("Written: " + file);
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
