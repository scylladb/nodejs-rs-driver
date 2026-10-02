//! Test-only helpers for deterministic client-side read-timeout integration tests.
//!
//! The proxy starts as a pass-through so that the JS test can connect, discover
//! metadata, and prepare its schema without races. The delay can then be enabled
//! for query execution requests on non-control connections only.

use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::Duration;

use scylla_proxy::{
    Condition, Node, Proxy, Reaction, RequestOpcode, RequestReaction, RequestRule, RunningProxy,
    ShardAwareness, get_exclusive_local_address,
};
use tokio::sync::Mutex;

use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_async,
};
use crate::session::SessionWrapper;

static RUNNING_PROXY: OnceLock<Mutex<Option<RunningProxy>>> = OnceLock::new();

fn running_proxy() -> &'static Mutex<Option<RunningProxy>> {
    RUNNING_PROXY.get_or_init(|| Mutex::new(None))
}

/// Remaps the session's shared default execution profile to use a short
/// request timeout. This lets the integration test prove that `readTimeout: 0`
/// explicitly selects a timeout-disabled profile instead of inheriting the
/// session default.
#[napi]
pub fn tests_set_session_default_read_timeout(session: &SessionWrapper, timeout_ms: u32) {
    let mut handle = session
        .inner
        .get_session()
        .get_default_execution_profile_handle()
        .clone();
    let profile = handle
        .pointee_to_builder()
        .request_timeout(Some(Duration::from_millis(timeout_ms.into())))
        .build();
    handle.map_to_another_profile(profile);
}

/// Starts a pass-through proxy for one real Scylla node and returns its address.
/// Any proxy left by an earlier invocation is stopped first.
#[napi]
pub async fn tests_start_read_timeout_proxy(backend: String) -> JsResult<String> {
    with_custom_error_async(async || {
        stop_running_proxy().await;

        let backend_addr: SocketAddr = backend.parse().map_err(|err| {
            ConvertedError::from(make_js_error(format!(
                "Invalid read-timeout proxy backend address {backend:?}: {err}"
            )))
        })?;
        let proxy_addr = SocketAddr::new(get_exclusive_local_address(), backend_addr.port());
        let proxy = Proxy::new([Node::new(
            backend_addr,
            proxy_addr,
            ShardAwareness::QueryNode,
            None,
            None,
        )]);
        let running = proxy.run().await.map_err(|err| {
            ConvertedError::from(make_js_error(format!(
                "Failed to start read-timeout proxy: {err}"
            )))
        })?;

        *running_proxy().lock().await = Some(running);
        ConvertedResult::Ok(proxy_addr.to_string())
    })
    .await
}

/// Delays execution requests on data connections while leaving the control
/// connection, metadata requests, and PREPARE requests untouched.
#[napi]
pub async fn tests_set_read_timeout_proxy_delay(delay_ms: u32) -> JsResult<()> {
    with_custom_error_async(async || {
        let mut guard = running_proxy().lock().await;
        let proxy = guard.as_mut().ok_or_else(|| {
            ConvertedError::from(make_js_error("Read-timeout proxy is not running"))
        })?;

        let execution_request = Condition::any([
            Condition::RequestOpcode(RequestOpcode::Query),
            Condition::RequestOpcode(RequestOpcode::Execute),
            Condition::RequestOpcode(RequestOpcode::Batch),
        ])
        .and(Condition::not(Condition::ConnectionRegisteredAnyEvent));
        let rules = vec![RequestRule(
            execution_request,
            RequestReaction::delay(Duration::from_millis(delay_ms.into())),
        )];

        for node in &mut proxy.running_nodes {
            node.change_request_rules(Some(rules.clone()));
        }
        ConvertedResult::Ok(())
    })
    .await
}

/// Restores pass-through behavior without interrupting existing connections.
#[napi]
pub async fn tests_clear_read_timeout_proxy_delay() -> JsResult<()> {
    with_custom_error_async(async || {
        let mut guard = running_proxy().lock().await;
        let proxy = guard.as_mut().ok_or_else(|| {
            ConvertedError::from(make_js_error("Read-timeout proxy is not running"))
        })?;
        proxy.turn_off_rules();
        ConvertedResult::Ok(())
    })
    .await
}

/// Stops the read-timeout proxy, if one is running.
#[napi]
pub async fn tests_stop_read_timeout_proxy() {
    stop_running_proxy().await;
}

async fn stop_running_proxy() {
    if let Some(proxy) = running_proxy().lock().await.take() {
        // Closing the client before the proxy is the preferred cleanup order,
        // but a disconnected driver is also an expected failure-path outcome.
        let _ = proxy.finish().await;
    }
}
