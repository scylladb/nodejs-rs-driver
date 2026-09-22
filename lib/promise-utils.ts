"use strict";

import { EventEmitter } from "events";
import { ExecutionOptions } from "./execution-options";
import type { Host } from "../";
import type { loadBalancing } from "./policies";

type LoadBalancingPolicy = loadBalancing.LoadBalancingPolicy;

/**
 * A callback that reports either a failure or the value produced.
 */
type ResultCallback<T = any> = (err?: Error | null, result?: T) => void;

/**
 * Creates a non-clearable timer that resolves the promise once elapses.
 */
function delay(ms?: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms || 0));
}

/**
 * Creates a Promise that gets resolved or rejected based on an event.
 */
function fromEvent<T = any>(
    emitter: EventEmitter,
    eventName: string,
): Promise<T> {
    return new Promise((resolve, reject) =>
        emitter.once(eventName, (err?: Error | null, result?: T) => {
            if (err) {
                reject(err);
            } else {
                resolve(result as T);
            }
        }),
    );
}

/**
 * Creates a Promise from a callback based function.
 */
function fromCallback<T = any>(
    fn: (callback: ResultCallback<T>) => void,
): Promise<T> {
    return new Promise((resolve, reject) =>
        fn((err?: Error | null, result?: T) => {
            if (err) {
                reject(err);
            } else {
                resolve(result as T);
            }
        }),
    );
}

/**
 * Gets a function that has the signature of a callback that invokes the appropriate promise handler parameters.
 */
function getCallback(
    resolve: (value: any) => void,
    reject: (reason?: any) => void,
): ResultCallback {
    return function (err?: Error | null, result?: any) {
        if (err) {
            reject(err);
        } else {
            resolve(result);
        }
    };
}

async function invokeSequentially(
    info: { counter: number },
    length: number,
    fn: (index: number) => Promise<any>,
): Promise<void> {
    let index;
    while ((index = info.counter++) < length) {
        await fn(index);
    }
}

/**
 * Invokes the new query plan of the load balancing policy and returns a Promise.
 * @param lbp The load balancing policy.
 * @param keyspace Name of currently logged keyspace at `Client` level.
 * @param executionOptions The information related to the execution of the request.
 */
function newQueryPlan(
    lbp: LoadBalancingPolicy,
    keyspace: string,
    executionOptions: ExecutionOptions,
): Promise<Iterator<Host>> {
    return new Promise((resolve, reject) => {
        lbp.newQueryPlan(keyspace, executionOptions, (err, iterator) => {
            if (err) {
                reject(err);
            } else {
                resolve(iterator as Iterator<Host>);
            }
        });
    });
}

/**
 * Method that handles optional callbacks (dual promise and callback support).
 * When callback is undefined it returns the promise.
 * When using a callback, it will use it as handlers of the continuation of the promise.
 */
function optionalCallback<T>(
    promise: Promise<T>,
    callback?: Function,
): Promise<T> | undefined {
    if (!callback) {
        return promise;
    }

    toCallback(promise, callback);
}

/**
 * Invokes the provided function multiple times, considering the concurrency level limit.
 */
function times(
    count: number,
    limit: number,
    fn: (index: number) => Promise<any>,
): Promise<void[]> {
    if (limit > count) {
        limit = count;
    }

    const promises = new Array(limit);

    const info = {
        counter: 0,
    };

    for (let i = 0; i < limit; i++) {
        promises[i] = invokeSequentially(info, count, fn);
    }

    return Promise.all(promises);
}

/**
 * Deals with unexpected rejections in order to avoid the unhandled promise rejection warning or failure.
 */
function toBackground(promise: Promise<any>): void {
    promise.catch(() => {});
}

/**
 * Invokes the callback once outside the promise chain the promise is resolved or rejected.
 */
function toCallback<T>(promise: Promise<T>, callback: Function): void {
    promise.then(
        (result) => process.nextTick(() => callback(null, result)),
        // Avoid marking the promise as rejected
        (err) => process.nextTick(() => callback(err)),
    );
}

export {
    delay,
    fromCallback,
    fromEvent,
    getCallback,
    newQueryPlan,
    optionalCallback,
    times,
    toBackground,
    toCallback,
};
