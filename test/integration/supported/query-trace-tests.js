"use strict";
const assert = require("chai").assert;

const helper = require("../../test-helper");
const types = require("../../../lib/types");
const {
    QueryTrace,
    TracingEvent,
} = require("../../../lib/metadata/query-trace");

describe("Client#metadata.getTrace()", function () {
    this.timeout(120000);

    describe("with a single node", function () {
        const setupInfo = helper.setup("1:0");

        /**
         * Executes a traced query and waits until the trace session has been persisted and is
         * readable, so a subsequent `getTrace()` call is guaranteed to find it.
         * @returns {Promise<Uuid>} the trace id
         */
        async function executeTracedQuery() {
            const client = setupInfo.client;
            const result = await client.execute(helper.queries.basic, [], {
                traceQuery: true,
            });

            const traceId = result.info.traceId;
            assert.instanceOf(traceId, types.Uuid);

            await helper.wait.until(async () => {
                const sessionRs = await client.execute(
                    "SELECT * FROM system_traces.sessions WHERE session_id=?",
                    [traceId],
                    { consistency: types.consistencies.one },
                );
                const row = sessionRs.first();
                return row && typeof row["duration"] === "number";
            });

            return traceId;
        }

        it("should retrieve a real QueryTrace instance", async () => {
            const traceId = await executeTracedQuery();
            const trace = await setupInfo.client.metadata.getTrace(traceId);

            assert.instanceOf(trace, QueryTrace);
            assert.isString(trace.requestType);
            assert.instanceOf(trace.coordinator, types.InetAddress);
            assert.isNumber(trace.startedAt);
            assert.isNumber(trace.duration);
        });

        it("should populate the events array with real TracingEvent instances", async () => {
            const traceId = await executeTracedQuery();
            const trace = await setupInfo.client.metadata.getTrace(traceId);

            assert.isArray(trace.events);
            assert.isAbove(trace.events.length, 0);

            trace.events.forEach((event) => {
                assert.instanceOf(event, TracingEvent);
                assert.instanceOf(event.id, types.Uuid);
                assert.isString(event.activity);
                assert.isNumber(event.elapsed);
            });
        });
    });
});
