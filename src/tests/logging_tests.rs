//! Test helpers for the logging module.
//!
//! These functions emit `tracing` events at specific levels so that the
//! JS-side test suite can verify that the forwarding layer works correctly.

use std::time::{Duration, Instant};

use napi::Env;

use crate::async_bridge::{self, BridgedPromise, JsAsyncResult};
use crate::errors::{ConvertedError, JsResult, make_js_error};

/// Emit one `tracing` event at each standard level (TRACE, DEBUG, INFO, WARN,
/// ERROR) with a predictable message and an extra field.
#[napi]
pub fn tests_emit_log_events() {
    tracing::trace!(test_field = "trace_extra", "trace message from rust");
    tracing::debug!(test_field = "debug_extra", "debug message from rust");
    tracing::info!(test_field = "info_extra", "info message from rust");
    tracing::warn!(test_field = "warn_extra", "warn message from rust");
    tracing::error!(test_field = "error_extra", "error message from rust");
}

/// Emit a single `tracing::info!` event with the given message.
/// Useful for verifying that arbitrary messages arrive on the JS side.
#[napi]
pub fn tests_emit_log_info(message: String) {
    tracing::info!("{}", message);
}

/// Emit an INFO event with multiple extra fields of different types.
/// Useful for verifying the exact format of `furtherInfo` on the JS side.
#[napi]
pub fn tests_emit_log_with_multiple_extras() {
    tracing::info!(
        str_field = "hello",
        int_field = 42,
        bool_field = true,
        "message with multiple extras"
    );
}

/// Emit an INFO event with no extra fields (message only).
#[napi]
pub fn tests_emit_log_message_only() {
    tracing::info!("message with no extras");
}

/// Emit an INFO event with a single string extra field.
#[napi]
pub fn tests_emit_log_with_single_str_extra() {
    tracing::info!(single_key = "single_value", "message with single extra");
}

/// Emit a WARN event inside a future on the bridge runtime, then resolve.
/// The event must reach the JS callbacks before the Promise settles.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_log_then_resolve(env: Env, message: String) -> JsAsyncResult<()> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            tracing::warn!("{}", message);
            Ok::<(), ConvertedError>(())
        })
    })
}

/// Emits an INFO event with `message`, then starts `count` futures that
/// resolve with 42. Returns their Promises.
///
/// The log event and all completions go to one drain, in this order:
/// 1. This function emits the event on the JavaScript thread.
///    The event goes into the queue first.
/// 2. This function blocks the JavaScript thread until all futures
///    put their completions into the queue.
///
/// The drain runs only on the JavaScript thread. So it cannot start
/// before all entries are in the queue.
#[napi(ts_return_type = "Array<Promise<number>>")]
pub fn tests_log_then_resolve_in_one_drain(
    env: Env,
    message: String,
    count: u32,
) -> JsResult<Vec<JsAsyncResult<i32>>> {
    let before = async_bridge::queued_entries(&env);
    tracing::info!("{}", message);
    let promises: Vec<JsAsyncResult<i32>> = (0..count)
        .map(|_| BridgedPromise::spawn(&env, || Ok(async { Ok::<i32, ConvertedError>(42) })))
        .collect();

    let expected = before + 1 + count as usize;
    let deadline = Instant::now() + Duration::from_secs(5);
    while async_bridge::queued_entries(&env) < expected {
        if Instant::now() > deadline {
            return JsResult::NapiError(make_js_error("The futures did not complete in 5 seconds"));
        }
        std::thread::sleep(Duration::from_millis(1));
    }
    JsResult::Ok(promises)
}
