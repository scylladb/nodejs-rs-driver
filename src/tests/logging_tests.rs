//! Test helpers for the logging module.
//!
//! These functions emit `tracing` events at specific levels so that the
//! JS-side test suite can verify that the forwarding layer works correctly.

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
