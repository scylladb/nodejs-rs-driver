//! Test-only helpers for deterministic client-side request-timeout integration tests.
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

use napi::Env;

use crate::async_bridge::{BridgedPromise, JsAsyncResult};
use crate::errors::{ConvertedError, ConvertedResult, make_js_error};
use crate::session::SessionWrapper;

static RUNNING_PROXY: OnceLock<Mutex<Option<RunningProxy>>> = OnceLock::new();

fn running_proxy() -> &'static Mutex<Option<RunningProxy>> {
    RUNNING_PROXY.get_or_init(|| Mutex::new(None))
}

/// Remaps the session's shared default execution profile to use a short
/// request timeout. This lets the integration test prove that `requestTimeout: 0`
/// explicitly selects a timeout-disabled profile instead of inheriting the
/// session default.
#[napi]
pub fn tests_set_session_default_request_timeout(session: &SessionWrapper, timeout_ms: u32) {
    let mut handle = session.inner.get_default_execution_profile_handle().clone();
    let profile = handle
        .pointee_to_builder()
        .request_timeout(Some(Duration::from_millis(timeout_ms.into())))
        .build();
    handle.map_to_another_profile(profile);
}

/// Starts a pass-through proxy for one real Scylla node and returns its address.
/// Any proxy left by an earlier invocation is stopped first.
///
/// The proxy runs on the bridge runtime of the calling env.
/// It stops working when that env exits, so call this only from the main thread.
#[napi(ts_return_type = "Promise<string>")]
pub fn tests_start_request_timeout_proxy(env: Env, backend: String) -> JsAsyncResult<String> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            stop_running_proxy().await;

            let backend_addr: SocketAddr = backend.parse().map_err(|err| {
                ConvertedError::from(make_js_error(format!(
                    "Invalid request-timeout proxy backend address {backend:?}: {err}"
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
                    "Failed to start request-timeout proxy: {err}"
                )))
            })?;

            *running_proxy().lock().await = Some(running);
            ConvertedResult::Ok(proxy_addr.to_string())
        })
    })
}

/// Delays execution requests on data connections while leaving the control
/// connection, metadata requests, and PREPARE requests untouched.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_set_request_timeout_proxy_delay(env: Env, delay_ms: u32) -> JsAsyncResult<()> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            let mut guard = running_proxy().lock().await;
            let proxy = guard.as_mut().ok_or_else(|| {
                ConvertedError::from(make_js_error("Request-timeout proxy is not running"))
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
    })
}

/// Restores pass-through behavior without interrupting existing connections.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_clear_request_timeout_proxy_delay(env: Env) -> JsAsyncResult<()> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            let mut guard = running_proxy().lock().await;
            let proxy = guard.as_mut().ok_or_else(|| {
                ConvertedError::from(make_js_error("Request-timeout proxy is not running"))
            })?;
            proxy.turn_off_rules();
            ConvertedResult::Ok(())
        })
    })
}

/// Stops the request-timeout proxy, if one is running.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_stop_request_timeout_proxy(env: Env) -> JsAsyncResult<()> {
    BridgedPromise::spawn(&env, || {
        Ok(async {
            stop_running_proxy().await;
            ConvertedResult::Ok(())
        })
    })
}

async fn stop_running_proxy() {
    if let Some(proxy) = running_proxy().lock().await.take() {
        // Closing the client before the proxy is the preferred cleanup order,
        // but a disconnected driver is also an expected failure-path outcome.
        let _ = proxy.finish().await;
    }
}
