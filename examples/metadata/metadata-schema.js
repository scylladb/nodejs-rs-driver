"use strict";

async function example() {
    process.exitCode = 1;
}

example().catch(function (err) {
    console.error("There was an error", err);
    process.exitCode = 1;
});
