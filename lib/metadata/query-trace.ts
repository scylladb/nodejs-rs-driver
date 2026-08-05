import InetAddress = require("../types/inet-address");
import Uuid = require("../types/uuid");
import Long = require("long");

/**
 * A single event that happened during a traced query execution.
 * @alias module:metadata~TracingEvent
 */
class TracingEvent {
    id: Uuid;
    activity: string | null;
    source: InetAddress | null;
    elapsed: number | null;
    thread: string | null;

    constructor(
        id: Uuid,
        activity: string | null,
        source: InetAddress | null,
        elapsed: number | null,
        thread: string | null,
    ) {
        this.id = id;
        this.activity = activity;
        this.source = source;
        this.elapsed = elapsed;
        this.thread = thread;
    }
}

/**
 * Tracing information retrieved for a query that was executed with tracing enabled.
 * @alias module:metadata~QueryTrace
 */
class QueryTrace {
    requestType: string | null;
    coordinator: InetAddress | null;
    parameters: { [key: string]: string };
    startedAt: number | Long | null;
    duration: number | null;
    clientAddress: InetAddress | null;
    events: TracingEvent[];

    constructor(
        requestType: string | null,
        coordinator: InetAddress | null,
        parameters: { [key: string]: string } | null,
        startedAt: number | Long | null,
        duration: number | null,
        clientAddress: InetAddress | null,
        events: TracingEvent[],
    ) {
        this.requestType = requestType;
        this.coordinator = coordinator;
        this.parameters = parameters || {};
        this.startedAt = startedAt;
        this.duration = duration;
        this.clientAddress = clientAddress;
        this.events = events;
    }
}

export { QueryTrace, TracingEvent };
