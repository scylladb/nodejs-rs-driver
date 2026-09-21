"use strict";

/** @module policies/reconnection */
/**
 * Base class for Reconnection Policies
 */
class ReconnectionPolicy {
    /**
     * A new reconnection schedule.
     * @returns An infinite iterator
     */
    newSchedule(): Iterator<number> {
        throw new Error(
            "You must implement a new schedule for the Reconnection class",
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
 * A reconnection policy that waits a constant time between each reconnection attempt.
 */
class ConstantReconnectionPolicy extends ReconnectionPolicy {
    delay: number;

    /**
     * @param delay Delay in ms
     */
    constructor(delay: number) {
        super();
        this.delay = delay;
    }

    /**
     * A new reconnection schedule that returns the same next delay value
     * @returns An infinite iterator
     */
    newSchedule(): Iterator<number> {
        const self = this;
        return {
            next: function () {
                return { value: self.delay, done: false };
            },
        };
    }

    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map<string, any>([["delay", this.delay]]);
    }
}

/**
 * A reconnection policy that waits exponentially longer between each
 * reconnection attempt (but keeps a constant delay once a maximum delay is reached).
 *
 * A random amount of jitter (+/- 15%) will be added to the pure exponential delay value to avoid situations
 * where many clients are in the reconnection process at exactly the same time. The jitter will never cause the
 * delay to be less than the base delay, or more than the max delay.
 */
class ExponentialReconnectionPolicy extends ReconnectionPolicy {
    baseDelay: number;
    maxDelay: number;
    startWithNoDelay?: boolean;

    /**
     * @param baseDelay The base delay in milliseconds to use for the schedules created by this policy.
     * @param maxDelay The maximum delay in milliseconds to wait between two reconnection attempt.
     * @param startWithNoDelay Determines if the first attempt should be zero delay
     */
    constructor(
        baseDelay: number,
        maxDelay: number,
        startWithNoDelay?: boolean,
    ) {
        super();
        this.baseDelay = baseDelay;
        this.maxDelay = maxDelay;
        this.startWithNoDelay = startWithNoDelay;
    }

    /**
     * A new schedule that uses an exponentially growing delay between reconnection attempts.
     * @returns An infinite iterator.
     */
    *newSchedule(): Generator<number> {
        let index = this.startWithNoDelay ? -1 : 0;

        while (true) {
            let delay = 0;

            if (index >= 64) {
                delay = this.maxDelay;
            } else if (index !== -1) {
                delay = Math.min(
                    Math.pow(2, index) * this.baseDelay,
                    this.maxDelay,
                );
            }

            index++;

            yield this._addJitter(delay);
        }
    }

    /**
     * Adds a random portion of +-15% to the delay provided.
     * Initially, its adds a random value of 15% to avoid reconnection before reaching the base delay.
     * When the schedule reaches max delay, only subtracts a random portion of 15%.
     */
    _addJitter(value: number): number {
        if (value === 0) {
            // Instant reconnection without jitter
            return value;
        }

        // Use the formula: 85% + rnd() * 30% to calculate the percentage of the original delay
        let minPercentage = 0.85;
        let range = 0.3;

        if (!this.startWithNoDelay && value === this.baseDelay) {
            // Between 100% to 115% of the original value
            minPercentage = 1;
            range = 0.15;
        } else if (value === this.maxDelay) {
            // Between 85% to 100% of the original value
            range = 0.15;
        }

        return Math.floor(value * (Math.random() * range + minPercentage));
    }

    /**
     * Gets an associative array containing the policy options.
     */
    getOptions(): Map<string, any> {
        return new Map<string, any>([
            ["baseDelay", this.baseDelay],
            ["maxDelay", this.maxDelay],
            ["startWithNoDelay", this.startWithNoDelay],
        ]);
    }
}

export {
    ReconnectionPolicy,
    ConstantReconnectionPolicy,
    ExponentialReconnectionPolicy,
};
