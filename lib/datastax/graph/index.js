"use strict";

/**
 * Graph module.
 * @module datastax/graph
 */

const GraphResultSet = require("./result-set");
const { asInt, asDouble, asFloat, asTimestamp, asUdt } = require("./wrappers");
const {
    Edge,
    Element,
    Path,
    Property,
    Vertex,
    VertexProperty,
} = require("./structure");

module.exports = {
    Edge,
    Element,
    Path,
    Property,
    Vertex,
    VertexProperty,

    asInt,
    asDouble,
    asFloat,
    asTimestamp,
    asUdt,
    GraphResultSet,
};
