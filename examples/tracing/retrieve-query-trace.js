"use strict";
const cassandra = require("@scylladb/driver");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());

/**
 * Executes a query with tracing enabled and retrieves the resulting trace session.
 */
async function example() {
    await client.connect();

    await client.execute(
        "CREATE KEYSPACE IF NOT EXISTS examples WITH replication =" +
            "{'class': 'NetworkTopologyStrategy', 'replication_factor': '1' }",
    );

    await client.execute(
        "CREATE TABLE IF NOT EXISTS examples.trace_tbl1 " +
            "(id uuid, txt text, PRIMARY KEY(id))",
    );

    // Pass `traceQuery: true` to ask the server to record a trace of this execution.
    const result = await client.execute(
        "INSERT INTO examples.trace_tbl1 (id, txt) VALUES (?, ?)",
        [cassandra.types.Uuid.random(), "hello trace"],
        { traceQuery: true, prepare: true },
    );

    // The id of the recorded trace session is reported on the result.
    const traceId = result.info.traceId;
    console.log("Trace id:", traceId.toString());

    // The server writes tracing data asynchronously, so it may not be readable the instant
    // the traced query returns. getTrace() retries a few times before giving up.
    const trace = await client.metadata.getTrace(traceId);

    console.log("Request type: %s", trace.requestType);
    console.log("Coordinator: %s", trace.coordinator);
    console.log(
        "Started at: %s",
        new Date(Number(trace.startedAt)).toISOString(),
    );
    console.log("Duration: %d microseconds", trace.duration);
    console.log("Parameters:", trace.parameters);

    console.log("Events:");
    for (const event of trace.events) {
        console.log(
            "- [+%d us] %s (on %s, thread %s)",
            event.elapsed,
            event.activity,
            event.source,
            event.thread,
        );
    }
}

example().catch(function (err) {
    console.error("There was an error", err);
    process.exitCode = 1;
});
