"use strict";

import errors = require("../errors");
import type { Client } from "../..";

/** @module policies/speculativeExecution */

/**
 * The plan a {@link SpeculativeExecutionPolicy} builds for a single query.
 */
interface SpeculativeExecutionPlan {
    nextExecution(): number;
}

/**
 * The policy that decides if the driver will send speculative queries to the next hosts when the current host takes too
 * long to respond.
 *
 * Note that only idempotent statements will be speculatively retried.
 * @abstract
 */
class SpeculativeExecutionPolicy {
    constructor() {}
    /**
     * Initialization method that gets invoked on Client startup.
     * @abstract
     */
    init(client: Client): void {}
    /**
     * Gets invoked at client shutdown, giving the opportunity to the implementor to perform cleanup.
     * @abstract
     */
    shutdown(): void {}
    /**
     * Gets the plan to use for a new query.
     * Returns an object with a `nextExecution()` method, which returns a positive number representing the
     * amount of milliseconds to delay the next execution or a non-negative number to avoid further executions.
     * @param keyspace The currently logged keyspace.
     * @param queryInfo The query, or queries in the case of batches, for which to build a plan.
     * @abstract
     */
    newPlan(
        keyspace: string,
        queryInfo: string | Array<string>,
    ): SpeculativeExecutionPlan {
        throw new Error(
            "You must implement newPlan() method in the SpeculativeExecutionPolicy",
        );
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map();
    }
}

/**
 * A {@link SpeculativeExecutionPolicy} that never schedules speculative executions.
 * @extends {SpeculativeExecutionPolicy}
 */
class NoSpeculativeExecutionPolicy extends SpeculativeExecutionPolicy {
    #plan: SpeculativeExecutionPlan;

    /**
     *  Creates a new instance of NoSpeculativeExecutionPolicy.
     */
    constructor() {
        super();
        this.#plan = {
            nextExecution: function () {
                return -1;
            },
        };
    }
    newPlan(): SpeculativeExecutionPlan {
        return this.#plan;
    }
}

/**
 * A {@link SpeculativeExecutionPolicy} that schedules a given number of speculative executions,
 * separated by a fixed delay.
 * @extends {SpeculativeExecutionPolicy}
 */
class ConstantSpeculativeExecutionPolicy extends SpeculativeExecutionPolicy {
    #delay: number;
    #maxSpeculativeExecutions: number;

    /**
     * Creates a new instance of ConstantSpeculativeExecutionPolicy.
     * @param delay The delay between each speculative execution.
     * @param maxSpeculativeExecutions The amount of speculative executions that should be scheduled after the
     * initial execution. Must be strictly positive.
     */
    constructor(delay: number, maxSpeculativeExecutions: number) {
        super();
        if (!(delay >= 0)) {
            throw new errors.ArgumentError(
                "delay must be a positive number or zero",
            );
        }
        if (!(maxSpeculativeExecutions > 0)) {
            throw new errors.ArgumentError(
                "maxSpeculativeExecutions must be a positive number",
            );
        }
        this.#delay = delay;
        this.#maxSpeculativeExecutions = maxSpeculativeExecutions;
    }
    newPlan(): SpeculativeExecutionPlan {
        let executions = 0;
        const self = this;
        return {
            nextExecution: function () {
                if (executions++ < self.#maxSpeculativeExecutions) {
                    return self.#delay;
                }
                return -1;
            },
        };
    }
    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map<string, any>([
            ["delay", this.#delay],
            ["maxSpeculativeExecutions", this.#maxSpeculativeExecutions],
        ]);
    }
}

export {
    NoSpeculativeExecutionPolicy,
    SpeculativeExecutionPolicy,
    ConstantSpeculativeExecutionPolicy,
};
