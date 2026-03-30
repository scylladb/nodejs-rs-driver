"use strict";
const selectWithRows = require("./parametrized_select");

module.exports = function (cassandra, client, stepCount, _concurrencyLevel) {
    // REMEMBER: update benchmark config.yml when changing the constant value.
    stepCount = stepCount || 100000;
    selectWithRows(cassandra, client, 10, stepCount);
};
