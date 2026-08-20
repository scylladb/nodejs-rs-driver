import { registerQueryTraceCtor, registerTracingEventCtor } from "../../index";
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

    /**
     * Constructs a TracingEvent instance.
     *
     * Instances of this class are constructed directly from the native code when retrieving
     * query tracing information.
     * @internal
     * @ignore
     */
    constructor(
        id: Buffer,
        activity: string | null,
        source: Buffer | null,
        elapsed: number | null,
        thread: string | null,
    ) {
        this.id = Uuid.fromRust(id);
        this.activity = activity;
        this.source = source ? new InetAddress(source) : null;
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

    /**
     * Constructs a QueryTrace instance.
     *
     * Instances of this class are constructed directly from the native code when retrieving
     * query tracing information.
     * @internal
     * @ignore
     */
    constructor(
        requestType: string | null,
        coordinator: Buffer | null,
        parameters: { [key: string]: string } | null,
        startedAt: number | Long | null,
        duration: number | null,
        clientAddress: Buffer | null,
        events: TracingEvent[],
    ) {
        this.requestType = requestType;
        this.coordinator = coordinator ? new InetAddress(coordinator) : null;
        this.parameters = parameters || {};
        this.startedAt = startedAt;
        this.duration = duration;
        this.clientAddress = clientAddress
            ? new InetAddress(clientAddress)
            : null;
        this.events = events;
    }
}

export { QueryTrace, TracingEvent };

// Registers the QueryTrace/TracingEvent constructors, so that Rust can
// construct fully-formed instances directly when retrieving query tracing information.
registerTracingEventCtor(TracingEvent);
registerQueryTraceCtor(QueryTrace);
