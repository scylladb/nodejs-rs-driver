import { registerQueryTraceCtor, registerTracingEventCtor } from "../../index";
import InetAddress = require("../types/inet-address");
import TimeUuid = require("../types/time-uuid");

/**
 * A single event that happened during a traced query execution.
 * @alias module:metadata~TracingEvent
 */
class TracingEvent {
    readonly id: TimeUuid;
    readonly activity: string | null;
    readonly source: InetAddress | null;
    readonly elapsed: number | null;
    readonly thread: string | null;

    /**
     * Constructs a TracingEvent instance.
     *
     * Instances of this class are constructed directly from the native code when retrieving
     * query tracing information, which passes the event id and the source address as their
     * raw bytes.
     * @param {Buffer} id
     * @param {string | null} activity
     * @param {Buffer | null} source
     * @param {number | null} elapsed
     * @param {string | null} thread
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
        this.id = TimeUuid.fromRust(id);
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
    readonly requestType: string | null;
    readonly coordinator: InetAddress | null;
    readonly parameters: Readonly<Record<string, string>>;
    readonly startedAt: Date | null;
    readonly duration: number | null;
    readonly clientAddress: InetAddress | null;
    readonly events: readonly TracingEvent[];

    /**
     * Constructs a QueryTrace instance.
     *
     * Instances of this class are constructed directly from the native code when retrieving
     * query tracing information, which passes the addresses as their raw bytes and the start
     * of the session as milliseconds since the Unix epoch.
     * @param {string | null} requestType
     * @param {Buffer | null} coordinator
     * @param {Record<string, string> | null} parameters
     * @param {number | null} startedAt
     * @param {number | null} duration
     * @param {Buffer | null} clientAddress
     * @param {TracingEvent[]} events
     * @internal
     * @ignore
     */
    constructor(
        requestType: string | null,
        coordinator: Buffer | null,
        parameters: Record<string, string> | null,
        startedAt: number | null,
        duration: number | null,
        clientAddress: Buffer | null,
        events: TracingEvent[],
    ) {
        this.requestType = requestType;
        this.coordinator = coordinator ? new InetAddress(coordinator) : null;
        this.parameters = parameters || {};
        this.startedAt =
            typeof startedAt === "number" ? new Date(startedAt) : null;
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
