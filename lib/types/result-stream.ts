"use strict";

import { Readable, ReadableOptions } from "stream";
import utils = require("../utils");
import errors = require("../errors");
// TODO: Remove after lib/client-options.js is converted to Typescript.
// @ts-ignore
import clientOptions = require("../client-options");

/** @module types */
/**
 * Readable stream using to yield data from a result or a field
 */
class ResultStream extends Readable {
    buffer: Array<any>;
    paused: boolean;

    #cancelAllowed: boolean;
    #handlersObject: any;
    #highWaterMarkRows: number;
    #readNext: (() => void) | null = null;

    constructor(opt?: ReadableOptions) {
        super(opt);
        this.buffer = [];
        this.paused = true;
        this.#cancelAllowed = false;
        this.#handlersObject = null;
        this.#highWaterMarkRows = 0;
    }

    _read(): void {
        this.paused = false;
        if (this.buffer.length === 0) {
            (this as any)._readableState.reading = false;
        }
        while (!this.paused && this.buffer.length > 0) {
            this.paused = !this.push(this.buffer.shift());
        }
        this.#checkBelowHighWaterMark();
        if (!this.paused && !this.buffer.length && this.#readNext) {
            this.#readNext();
            this.#readNext = null;
        }
    }

    /**
     * Allows for throttling, helping nodejs keep the internal buffers reasonably sized.
     * @param readNext function that triggers reading the next result chunk
     * @ignore
     */
    _valve(readNext?: (() => void) | null): void {
        this.#readNext = null;
        if (!readNext) {
            return;
        }
        if (this.paused || this.buffer.length) {
            this.#readNext = readNext;
        } else {
            readNext();
        }
    }

    add(chunk: any): number {
        const length = this.buffer.push(chunk);
        this.read(0);
        this.#checkAboveHighWaterMark();
        return length;
    }

    #checkAboveHighWaterMark(): void {
        if (
            !this.#handlersObject ||
            !this.#handlersObject.resumeReadingHandler
        ) {
            return;
        }
        if (
            this.#highWaterMarkRows === 0 ||
            this.buffer.length !== this.#highWaterMarkRows
        ) {
            return;
        }
        this.#handlersObject.resumeReadingHandler(false);
    }

    #checkBelowHighWaterMark(): void {
        if (
            !this.#handlersObject ||
            !this.#handlersObject.resumeReadingHandler
        ) {
            return;
        }
        if (
            this.#highWaterMarkRows === 0 ||
            this.buffer.length >= this.#highWaterMarkRows
        ) {
            return;
        }
        // The consumer has dequeued below the watermark
        this.#handlersObject.resumeReadingHandler(true);
    }

    /**
     * When continuous paging is enabled, allows the client to notify to the server to stop pushing further pages.
     *
     * Note: This is not part of the public API yet.
     * @param callback The cancel method accepts an optional callback.
     * @example <caption>Cancelling a continuous paging execution</caption>
     * const stream = client.stream(query, params, { prepare: true, continuousPaging: true });
     * // ...
     * // Ask the server to stop pushing rows.
     * stream.cancel();
     * @ignore
     */
    cancel(callback?: (err?: Error) => void): void {
        if (!this.#cancelAllowed) {
            const err = new Error(
                "You can only cancel streaming executions when continuous paging is enabled",
            );
            if (!callback) {
                throw err;
            }
            return callback(err);
        }
        if (!this.#handlersObject) {
            throw new errors.DriverInternalError(
                "ResultStream cancel is allowed but the cancel options were not set",
            );
        }
        callback = callback || utils.noop;
        if (!this.#handlersObject.cancelHandler) {
            // The handler is not yet set
            // Set the callback as a flag to identify that the cancel handler must be invoked when set
            this.#handlersObject.cancelHandler = callback;
            return;
        }
        this.#handlersObject.cancelHandler(callback);
    }

    /**
     * Sets the pointer to the handler to be used to cancel the continuous page execution.
     * @internal
     * @ignore
     */
    setHandlers(options: any): void {
        if (!options.continuousPaging) {
            return;
        }
        this.#cancelAllowed = true;
        this.#handlersObject = options;
        this.#highWaterMarkRows =
            options.continuousPaging.highWaterMarkRows ||
            clientOptions.continuousPageDefaultHighWaterMark;
    }
}

export = ResultStream;
