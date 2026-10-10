use std::time::Duration;
use std::{ffi::CString, ptr};

use napi::bindgen_prelude::*;
use napi::sys;

use crate::async_bridge::{BridgedPromise, JsAsyncResult};
use crate::errors::ConvertedError;

// ---------------------------------------------------------------------------
// Resolve paths
// ---------------------------------------------------------------------------

/// Resolves with 42 on the first poll (no Pending).
/// The completion still goes through the queue and the drain.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_resolve_immediate(env: Env) -> JsAsyncResult<i32> {
    BridgedPromise::spawn(&env, || Ok(async move { Ok::<i32, ConvertedError>(42) }))
}

/// Resolves with `millis` after sleeping for `millis` milliseconds.
/// The future completes on the Tokio worker after the timer expires,
/// exercising the worker → completion queue → TSFN → drain path.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_resolve_delayed(env: Env, millis: u32) -> JsAsyncResult<i32> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            tokio::time::sleep(Duration::from_millis(millis as u64)).await;
            Ok::<i32, ConvertedError>(millis as i32)
        })
    })
}

/// Resolves with a String value.
/// Tests a different ToNapiValue type so that type erasure in the settle
/// callback does not silently confuse return types.
#[napi(ts_return_type = "Promise<string>")]
pub fn tests_casync_resolve_string(env: Env) -> JsAsyncResult<String> {
    BridgedPromise::spawn(&env, || {
        Ok(async move { Ok::<String, ConvertedError>("hello from async".to_string()) })
    })
}

/// Resolves with a bool.
#[napi(ts_return_type = "Promise<boolean>")]
pub fn tests_casync_resolve_bool(env: Env, value: bool) -> JsAsyncResult<bool> {
    BridgedPromise::spawn(&env, || {
        Ok(async move { Ok::<bool, ConvertedError>(value) })
    })
}

// ---------------------------------------------------------------------------
// Reject paths
// ---------------------------------------------------------------------------

/// Rejects with a ConvertedError produced from a real scylla error.
/// The JS side can assert `.message` and `.name` on the rejection value.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_reject(env: Env) -> JsAsyncResult<i32> {
    BridgedPromise::spawn(&env, || {
        Ok(async move { Err::<i32, ConvertedError>(scylla::errors::BadKeyspaceName::Empty.into()) })
    })
}

/// Fails in `prepare`, before the bridge creates a Promise.
/// The call must throw synchronously.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_prepare_error(env: Env) -> JsAsyncResult<i32> {
    BridgedPromise::spawn(&env, || {
        let error: ConvertedError = scylla::errors::BadKeyspaceName::Empty.into();
        Err::<std::future::Pending<_>, _>(error)
    })
}

/// Rejects after a delay, exercising the waker path on the error branch.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_reject_delayed(env: Env, millis: u32) -> JsAsyncResult<i32> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            tokio::time::sleep(Duration::from_millis(millis as u64)).await;
            Err::<i32, ConvertedError>(scylla::errors::BadKeyspaceName::Empty.into())
        })
    })
}

/// Rejects with a ConvertedError whose message contains an interior null byte.
/// This exercises direct error conversion, which preserves the full message.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_reject_null_byte(env: Env) -> JsAsyncResult<i32> {
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

    BridgedPromise::spawn(&env, || {
        Ok(async move { Err::<i32, ConvertedError>(NullByteError.into()) })
    })
}

// ---------------------------------------------------------------------------
// Waker path
// ---------------------------------------------------------------------------

/// Submits a future that is woken multiple times before it completes.
/// Uses tokio::sync::Notify: a spawned task calls notify_one() twice in quick
/// succession. The promise must still resolve exactly once with the correct value.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_multi_wake(env: Env) -> JsAsyncResult<i32> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            // This future runs on the bridge runtime, so tokio::spawn is valid here.
            let notify = std::sync::Arc::new(tokio::sync::Notify::new());
            let notify2 = std::sync::Arc::clone(&notify);

            tokio::spawn(async move {
                // Fire two notifications back-to-back.
                notify2.notify_one();
                notify2.notify_one();
            });

            notify.notified().await;
            Ok::<i32, ConvertedError>(99)
        })
    })
}

/// Test value that spawns another future during conversion.
pub struct NestedPromise;

impl ToNapiValue for NestedPromise {
    unsafe fn to_napi_value(env: sys::napi_env, _: Self) -> napi::Result<sys::napi_value> {
        let env_wrapper = Env::from_raw(env);
        let promise =
            BridgedPromise::spawn(&env_wrapper, || Ok(async { Ok::<i32, ConvertedError>(42) }));
        unsafe { JsAsyncResult::<i32>::to_napi_value(env, promise) }
    }
}

/// Exercises spawning a future while another future is being converted to JS.
#[napi(ts_return_type = "Promise<number>")]
pub fn tests_casync_nested_promise(env: Env) -> JsAsyncResult<NestedPromise> {
    BridgedPromise::spawn(&env, || {
        Ok(async { Ok::<_, ConvertedError>(NestedPromise) })
    })
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
pub fn tests_casync_throwing_conversion(env: Env) -> JsAsyncResult<ThrowingConversion> {
    BridgedPromise::spawn(&env, || {
        Ok(async { Ok::<_, ConvertedError>(ThrowingConversion) })
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
) -> JsAsyncResult<FailedConversionWithNullByte> {
    BridgedPromise::spawn(&env, || {
        Ok(async { Ok::<_, ConvertedError>(FailedConversionWithNullByte) })
    })
}
