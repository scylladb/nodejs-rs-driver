// Single entry point for all benchmarks.
// This file takes the name of the benchmark, including driver name, step count and concurrency level
// and runs the corresponding benchmark logic, loaded at runtime.

"use strict";
const { exit } = require("process");

// We need to validate driver name before loading utils, as utils loads the driver.
const driverName = process.argv[2];
const benchmarkName = process.argv[3];
if (!driverName || !benchmarkName) {
    console.error("Usage: node benchmark.js <driver> <benchmark-name> [step-count] [concurrency]");
    exit(1);
}

const utils = require("./utils");

// Default step count is defined in each benchmark.
// See runner-config/config.yml for more information.
const defaultStepCount = undefined
const defaultConcurrencyLevel = 100;

// Each individual benchmark has a default step count defined.
// See the explanation in config.yml for more details.
const stepCount = process.argv[4] === undefined || process.argv[4] !== "default" ? parseInt(process.argv[4], 10) : defaultStepCount;
const concurrencyLevel = process.argv[5] === undefined || process.argv[5] !== "default" ? parseInt(process.argv[5], 10) : defaultConcurrencyLevel;


const cassandra = require(driverName);
const client = new cassandra.Client(utils.getClientArgs());

const benchmark = require(`./${benchmarkName}`);
benchmark(cassandra, client, stepCount, concurrencyLevel);
