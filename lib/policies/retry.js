"use strict";

const { throwNotSupported } = require("../new-utils");
const rust = require("../../index");

/** @module policies/retry */
/**
 * Base and default RetryPolicy.
 * Determines what to do when the driver runs into a specific database exception.
 *
 * This policy is implemented on the Rust side, see:
 * https://github.com/scylladb/scylla-rust-driver/blob/main/scylla/src/policies/retry/default.rs
 * For more information see the DefaultRetryPolicy here:
 * https://docs.datastax.com/en/developer/java-driver/4.11/manual/core/retries/index.html
 */
class RetryPolicy {
    constructor() {}

    retryResult(consistency, useCurrentHost) {
        throw new ReferenceError(
            "Currently only built-in retry policies are supported.",
        );
    }

    rethrowResult() {
        throw new ReferenceError(
            "Currently only built-in retry policies are supported.",
        );
    }

    get retryDecision() {
        throw new ReferenceError(
            "Currently only built-in retry policies are supported.",
        );
    }

    /**
     * @returns {rust.RetryPolicyKind}
     * @package
     */
    getRustConfiguration() {
        if (this.constructor !== RetryPolicy) {
            throw new TypeError(
                "Currently only built-in retry policies are supported. Inheriting from RetryPolicy is not supported.",
            );
        }
        return rust.RetryPolicyKind.Default;
    }
}

/**
 * @deprecated This policy was deprecated in the DSx driver, and it's removed in this driver.
 *
 * Since version 4.0 non-idempotent operations are never tried for write timeout or request error, use the
 * default retry policy instead.
 */
class IdempotenceAwareRetryPolicy extends RetryPolicy {
    /**
     * Creates a new instance of `IdempotenceAwareRetryPolicy`.
     * @param {RetryPolicy} [childPolicy] The child retry policy to wrap. When not defined, it will use an instance of
     * [RetryPolicy]{@link module:policies/retry~RetryPolicy} as child policy.
     */
    // eslint-disable-next-line constructor-super
    constructor(childPolicy) {
        throwNotSupported("IdempotenceAwareRetryPolicy");
    }
}

/**
 * A retry policy that never retries and returns errors straight to the user.
 *
 * If this policy is used, retry logic will have to be
 * implemented in business code.
 *
 * This policy is implemented on the Rust side.
 *
 * @alias module:policies/retry~FallthroughRetryPolicy
 * @extends RetryPolicy
 */
class FallthroughRetryPolicy extends RetryPolicy {
    /**
     * Creates a new instance of FallthroughRetryPolicy.
     */
    constructor() {
        super();
    }

    /**
     * @returns {rust.RetryPolicyKind}
     * @package
     */
    getRustConfiguration() {
        if (this.constructor !== FallthroughRetryPolicy) {
            throw new TypeError(
                "Currently only built-in retry policies are supported. Inheriting from FallthroughRetryPolicy is not supported.",
            );
        }
        return rust.RetryPolicyKind.Fallthrough;
    }
}

exports.IdempotenceAwareRetryPolicy = IdempotenceAwareRetryPolicy;
exports.FallthroughRetryPolicy = FallthroughRetryPolicy;
exports.RetryPolicy = RetryPolicy;
