// @ts-nocheck
"use strict";

const errors = require("../errors");

/** @module policies/speculativeExecution */

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
   * @param {Client} client
   * @abstract
   */
  init(client) {}
  /**
   * Gets invoked at client shutdown, giving the opportunity to the implementor to perform cleanup.
   * @abstract
   */
  shutdown() {}
  /**
   * Gets the plan to use for a new query.
   * Returns an object with a `nextExecution()` method, which returns a positive number representing the
   * amount of milliseconds to delay the next execution or a non-negative number to avoid further executions.
   * @param {String} keyspace The currently logged keyspace.
   * @param {String|Array<String>} queryInfo The query, or queries in the case of batches, for which to build a plan.
   * @return {{nextExecution: function}}
   * @abstract
   */
  newPlan(keyspace, queryInfo) {
    throw new Error(
      "You must implement newPlan() method in the SpeculativeExecutionPolicy",
    );
  }
  /**
   * Gets an associative array containing the policy options.
   */
  getOptions() {
    return new Map();
  }
}

/**
 * A {@link SpeculativeExecutionPolicy} that never schedules speculative executions.
 * @extends {SpeculativeExecutionPolicy}
 */
class NoSpeculativeExecutionPolicy extends SpeculativeExecutionPolicy {
  /**
   *  Creates a new instance of NoSpeculativeExecutionPolicy.
   */
  constructor() {
    super();
    this._plan = {
      nextExecution: function () {
        return -1;
      },
    };
  }
  newPlan() {
    return this._plan;
  }
}

/**
 * A {@link SpeculativeExecutionPolicy} that schedules a given number of speculative executions,
 * separated by a fixed delay.
 * @extends {SpeculativeExecutionPolicy}
 */
class ConstantSpeculativeExecutionPolicy extends SpeculativeExecutionPolicy {
  /**
   * Creates a new instance of ConstantSpeculativeExecutionPolicy.
   * @param {Number} delay The delay between each speculative execution.
   * @param {Number} maxSpeculativeExecutions The amount of speculative executions that should be scheduled after the
   * initial execution. Must be strictly positive.
   */
  constructor(delay, maxSpeculativeExecutions) {
    super();
    if (!(delay >= 0)) {
      throw new errors.ArgumentError("delay must be a positive number or zero");
    }
    if (!(maxSpeculativeExecutions > 0)) {
      throw new errors.ArgumentError(
        "maxSpeculativeExecutions must be a positive number",
      );
    }
    this._delay = delay;
    this._maxSpeculativeExecutions = maxSpeculativeExecutions;
  }
  newPlan() {
    let executions = 0;
    const self = this;
    return {
      nextExecution: function () {
        if (executions++ < self._maxSpeculativeExecutions) {
          return self._delay;
        }
        return -1;
      },
    };
  }
  /**
   * Gets an associative array containing the policy options.
   */
  getOptions() {
    return new Map([
      ["delay", this._delay],
      ["maxSpeculativeExecutions", this._maxSpeculativeExecutions],
    ]);
  }
}

exports.NoSpeculativeExecutionPolicy = NoSpeculativeExecutionPolicy;
exports.SpeculativeExecutionPolicy = SpeculativeExecutionPolicy;
exports.ConstantSpeculativeExecutionPolicy = ConstantSpeculativeExecutionPolicy;
