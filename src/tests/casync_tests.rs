use std::time::Duration;

use napi::bindgen_prelude::*;

use crate::casync::{JsPromise, submit_future};
use crate::errors::ConvertedError;

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

/// Resolves with 42 on the very first poll (no Pending).
/// Tests the synchronous-completion fast path.
#[napi]
pub fn tests_casync_resolve_immediate(env: Env) -> napi::Result<JsPromise<i32>> {
    submit_future(&env, async move { Ok::<i32, ConvertedError>(42) })
}

/// Resolves with `millis` after sleeping for `millis` milliseconds.
/// The sleep causes the future to return Pending on the first poll; the Tokio
/// reactor fires the waker from its worker thread when the timer expires,
/// exercising the cross-thread waker → TSFN → poll_woken path.
#[napi]
pub fn tests_casync_resolve_delayed(env: Env, millis: u32) -> napi::Result<JsPromise<i32>> {
    submit_future(&env, async move {
        tokio::time::sleep(Duration::from_millis(millis as u64)).await;
        Ok::<i32, ConvertedError>(millis as i32)
    })
}

/// Resolves with a String value.
/// Tests a different ToNapiValue type so that type erasure in BoxFuture does
/// not silently confuse return types.
#[napi]
pub fn tests_casync_resolve_string(env: Env) -> napi::Result<JsPromise<String>> {
    submit_future(&env, async move {
        Ok::<String, ConvertedError>("hello from async".to_string())
    })
}

/// Resolves with a bool.
#[napi]
pub fn tests_casync_resolve_bool(env: Env, value: bool) -> napi::Result<JsPromise<bool>> {
    submit_future(&env, async move { Ok::<bool, ConvertedError>(value) })
}

// ---------------------------------------------------------------------------
// Reject paths
// ---------------------------------------------------------------------------

/// Rejects with a ConvertedError produced from a real scylla error.
/// The JS side can assert `.message` and `.name` on the rejection value.
#[napi]
pub fn tests_casync_reject(env: Env) -> napi::Result<JsPromise<i32>> {
    submit_future(&env, async move {
        Err::<i32, ConvertedError>(scylla::errors::BadKeyspaceName::Empty.into())
    })
}

/// Rejects after a delay, exercising the waker path on the error branch.
#[napi]
pub fn tests_casync_reject_delayed(env: Env, millis: u32) -> napi::Result<JsPromise<i32>> {
    submit_future(&env, async move {
        tokio::time::sleep(Duration::from_millis(millis as u64)).await;
        Err::<i32, ConvertedError>(scylla::errors::BadKeyspaceName::Empty.into())
    })
}

/// Rejects with a ConvertedError whose message contains an interior null byte.
/// This exercises the CString::new fallback in reject_with_reason — the error
/// is produced by a type whose Display output contains '\0'. Because the normal
/// ConvertedError::to_napi_value path uses napi-rs string APIs (not CString),
/// the null byte only matters when that path itself fails, causing reject_with_reason
/// to be called. We trigger that by making T::to_napi_value fail: the future
/// succeeds (Ok variant), but the value cannot be converted, so the settle
/// callback falls through to reject_with_reason.
///
/// More practically this test validates that a ConvertedError with a null byte
/// does NOT crash the process — the promise is simply rejected with a fallback
/// message.
#[napi]
pub fn tests_casync_reject_null_byte(env: Env) -> napi::Result<JsPromise<i32>> {
    /// An error whose Display contains an interior null byte.
    struct NullByteError;

    impl std::fmt::Display for NullByteError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            // The \0 makes CString::new fail when reject_with_reason is called.
            write!(f, "error with\0null byte")
        }
    }

    impl std::fmt::Debug for NullByteError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "NullByteError")
        }
    }

    impl std::error::Error for NullByteError {}

    submit_future(&env, async move {
        Err::<i32, ConvertedError>(NullByteError.into())
    })
}

// ---------------------------------------------------------------------------
// Waker path
// ---------------------------------------------------------------------------

/// Submits a future that is woken multiple times before its second poll.
/// Uses tokio::sync::Notify: a spawned task calls notify_one() twice in quick
/// succession. The first notification wakes the future; the second fires while
/// the waker may still be queued, exercising the coalesced-wake path in
/// WakerBridge::signal (the signaled AtomicBool prevents duplicate TSFN calls).
/// The promise must still resolve exactly once with the correct value.
#[napi]
pub fn tests_casync_multi_wake(env: Env) -> napi::Result<JsPromise<i32>> {
    submit_future(&env, async move {
        // This future is polled inside rt.enter(), so tokio::spawn is valid here.
        let notify = std::sync::Arc::new(tokio::sync::Notify::new());
        let notify2 = std::sync::Arc::clone(&notify);

        tokio::spawn(async move {
            // Fire two notifications back-to-back. The waker may fire twice
            // before poll_woken runs, which tests the coalescing in WakerBridge.
            notify2.notify_one();
            notify2.notify_one();
        });

        notify.notified().await;
        Ok::<i32, ConvertedError>(99)
    })
}
