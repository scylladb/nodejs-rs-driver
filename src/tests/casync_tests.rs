use std::time::Duration;
use std::{ffi::CString, ptr};

use napi::bindgen_prelude::*;
use napi::sys;

use crate::async_bridge::{JsPromise, submit_future};
use crate::errors::{ConvertedError, JsResult, with_custom_error_sync};

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

/// Resolves with 42 on the very first poll (no Pending).
/// Tests the synchronous-completion fast path.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_resolve_immediate(env: Env) -> JsResult<JsPromise<i32>> {
    with_custom_error_sync(|| submit_future(&env, async move { Ok::<i32, ConvertedError>(42) }))
}

/// Resolves with `millis` after sleeping for `millis` milliseconds.
/// The sleep causes the future to return Pending on the first poll; the Tokio
/// reactor fires the waker from its worker thread when the timer expires,
/// exercising the cross-thread waker → TSFN → poll_woken path.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_resolve_delayed(env: Env, millis: u32) -> JsResult<JsPromise<i32>> {
    with_custom_error_sync(|| {
        submit_future(&env, async move {
            tokio::time::sleep(Duration::from_millis(millis as u64)).await;
            Ok::<i32, ConvertedError>(millis as i32)
        })
    })
}

/// Resolves with a String value.
/// Tests a different ToNapiValue type so that type erasure in BoxFuture does
/// not silently confuse return types.
#[napi(ts_return_type = "Promise<string>")]
pub fn tests_casync_resolve_string(env: Env) -> JsResult<JsPromise<String>> {
    with_custom_error_sync(|| {
        submit_future(&env, async move {
            Ok::<String, ConvertedError>("hello from async".to_string())
        })
    })
}

/// Resolves with a bool.
#[napi(ts_return_type = "Promise<boolean>")]
pub fn tests_casync_resolve_bool(env: Env, value: bool) -> JsResult<JsPromise<bool>> {
    with_custom_error_sync(|| submit_future(&env, async move { Ok::<bool, ConvertedError>(value) }))
}

// ---------------------------------------------------------------------------
// Reject paths
// ---------------------------------------------------------------------------

/// Rejects with a ConvertedError produced from a real scylla error.
/// The JS side can assert `.message` and `.name` on the rejection value.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_reject(env: Env) -> JsResult<JsPromise<i32>> {
    with_custom_error_sync(|| {
        submit_future(&env, async move {
            Err::<i32, ConvertedError>(scylla::errors::BadKeyspaceName::Empty.into())
        })
    })
}

/// Rejects after a delay, exercising the waker path on the error branch.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_reject_delayed(env: Env, millis: u32) -> JsResult<JsPromise<i32>> {
    with_custom_error_sync(|| {
        submit_future(&env, async move {
            tokio::time::sleep(Duration::from_millis(millis as u64)).await;
            Err::<i32, ConvertedError>(scylla::errors::BadKeyspaceName::Empty.into())
        })
    })
}

/// Rejects with a ConvertedError whose message contains an interior null byte.
/// This exercises direct error conversion, which preserves the full message.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_reject_null_byte(env: Env) -> JsResult<JsPromise<i32>> {
    /// An error whose Display contains an interior null byte.
    struct NullByteError;

    impl std::fmt::Display for NullByteError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "error with\0null byte")
        }
    }

    impl std::fmt::Debug for NullByteError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "NullByteError")
        }
    }

    impl std::error::Error for NullByteError {}

    with_custom_error_sync(|| {
        submit_future(&env, async move {
            Err::<i32, ConvertedError>(NullByteError.into())
        })
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
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_multi_wake(env: Env) -> JsResult<JsPromise<i32>> {
    with_custom_error_sync(|| {
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
    })
}

/// Test value that submits another future during conversion.
pub struct NestedPromise;

impl ToNapiValue for NestedPromise {
    unsafe fn to_napi_value(env: sys::napi_env, _: Self) -> napi::Result<sys::napi_value> {
        let env_wrapper = Env::from_raw(env);
        let promise = submit_future(&env_wrapper, async { Ok::<i32, ConvertedError>(42) })
            .map_err(|error| napi::Error::from_reason(error.to_string()))?;
        unsafe { JsPromise::<i32>::to_napi_value(env, promise) }
    }
}

/// Exercises future submission while another future is being converted to JS.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_nested_promise(env: Env) -> JsResult<JsPromise<NestedPromise>> {
    with_custom_error_sync(|| submit_future(&env, async { Ok::<_, ConvertedError>(NestedPromise) }))
}

/// Test value that leaves a pending JavaScript exception during conversion.
pub struct ThrowingConversion;

impl ToNapiValue for ThrowingConversion {
    unsafe fn to_napi_value(env: sys::napi_env, _: Self) -> napi::Result<sys::napi_value> {
        let message = CString::new("conversion failed").unwrap();
        // SAFETY: The message remains valid for this Node-API call.
        let status = unsafe { sys::napi_throw_error(env, ptr::null(), message.as_ptr()) };
        if status != sys::Status::napi_ok {
            return Err(napi::Error::from_status(status.into()));
        }
        Err(napi::Error::from_reason("Rust conversion reason"))
    }
}

/// Exercises promise rejection after a conversion leaves a JS exception pending.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_casync_throwing_conversion(env: Env) -> JsResult<JsPromise<ThrowingConversion>> {
    with_custom_error_sync(|| {
        submit_future(&env, async { Ok::<_, ConvertedError>(ThrowingConversion) })
    })
}

/// Test value whose conversion fails without leaving a JS exception pending.
pub struct FailedConversionWithNullByte;

impl ToNapiValue for FailedConversionWithNullByte {
    unsafe fn to_napi_value(_: sys::napi_env, _: Self) -> napi::Result<sys::napi_value> {
        Err(napi::Error::from_reason("conversion\0failed"))
    }
}

/// Exercises the rejection fallback for conversion errors containing a null byte.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_casync_conversion_error_with_null_byte(
    env: Env,
) -> JsResult<JsPromise<FailedConversionWithNullByte>> {
    with_custom_error_sync(|| {
        submit_future(&env, async {
            Ok::<_, ConvertedError>(FailedConversionWithNullByte)
        })
    })
}

/// Emits a warning before resolving, like a failed schema-agreement check.
#[napi(ts_return_type = "Promise<boolean>")]
pub fn tests_casync_log_then_resolve(env: Env) -> JsResult<JsPromise<bool>> {
    with_custom_error_sync(|| {
        submit_future(&env, async {
            tracing::warn!("schema agreement logging order probe");
            tokio::time::sleep(Duration::from_millis(1)).await;
            Ok(false)
        })
    })
}
