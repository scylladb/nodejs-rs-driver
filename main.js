"use strict";

// In pedantic mode, when any warnings are detected, exit program imminently
const process = require("node:process");
if (process.env.PEDANTIC == "true") {
    process.on("warning", (warning) => {
        console.warn(`Warning found in pedantic mode:`);
        console.warn(warning.message);
        console.warn(warning.stack);
        process.exit(1);
    });
}

const clientOptions = require("./lib/client-options");
exports.Client = require("./lib/client");
exports.ExecutionProfile = require("./lib/execution-profile").ExecutionProfile;
exports.ExecutionOptions = require("./lib/execution-options").ExecutionOptions;
exports.types = require("./lib/types");
exports.errors = require("./lib/errors");
exports.policies = require("./lib/policies");
exports.auth = require("./lib/auth");
exports.mapping = require("./lib/mapping");
exports.tracker = require("./lib/tracker");
exports.metrics = require("./lib/metrics");
exports.concurrent = require("./lib/concurrent");

const token = require("./lib/token");
exports.token = {
    Token: token.Token,
    TokenRange: token.TokenRange,
};
const Metadata = require("./lib/metadata");
exports.metadata = {
    Metadata: Metadata,
};
exports.geometry = require("./lib/geometry");
exports.datastax = require("./lib/datastax");
/**
 * Returns a new instance of the default [options]{@link ClientOptions} used by the driver.
 */
exports.defaultOptions = function () {
    return clientOptions.defaultOptions();
};
exports.version = require("./package.json").version;
