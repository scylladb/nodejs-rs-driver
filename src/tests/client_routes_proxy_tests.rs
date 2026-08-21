//! Test-only helpers for the client routes integration test.
//!
//! These wrap `scylla-proxy`'s `nlb` module - the same fake network load balancer
//! the upstream rust driver's own client-routes integration tests rely on.
//!
//! Only compiled when built with the `client-routes-proxy-tests` feature.

use std::net::SocketAddr;
use std::sync::OnceLock;

use scylla_proxy::nlb::{NlbFrontend, RunningNlbFrontend};
use tokio::sync::Mutex;

use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_async,
};

/// A single process-wide slot for tracking running NLBs.
static RUNNING_NLBS: OnceLock<Mutex<Vec<RunningNlbFrontend>>> = OnceLock::new();

fn running_nlbs() -> &'static Mutex<Vec<RunningNlbFrontend>> {
    RUNNING_NLBS.get_or_init(|| Mutex::new(Vec::new()))
}

/// Starts one NLB per given backend address, each forwarding plain TCP to a
/// single backend - matching how a client routes proxy exposes one node per port.
///
/// Returns the address the driver should be told to connect to for each backend
/// (via a posted `system.client_routes` row), in the same order as `backends`.
/// Replaces any NLBs started by a previous call.
#[napi]
pub async fn tests_start_client_routes_nlbs(backends: Vec<String>) -> JsResult<Vec<String>> {
    with_custom_error_async(async || {
        stop_running_nlbs().await;

        let mut listen_addrs = Vec::with_capacity(backends.len());
        let mut started = Vec::with_capacity(backends.len());

        for backend in backends {
            let backend_addr: SocketAddr = backend.parse().map_err(|err| {
                ConvertedError::from(make_js_error(format!(
                    "Invalid backend address {backend:?}: {err}"
                )))
            })?;

            let nlb = NlbFrontend::builder()
                .listen_addr("127.0.0.1:0".parse().unwrap())
                .backend(backend_addr)
                .build()
                .run()
                .await
                .map_err(|err| {
                    ConvertedError::from(make_js_error(format!(
                        "Failed to start NLB for {backend_addr}: {err}"
                    )))
                })?;

            listen_addrs.push(nlb.listen_addr().to_string());
            started.push(nlb);
        }

        *running_nlbs().lock().await = started;
        ConvertedResult::Ok(listen_addrs)
    })
    .await
}

/// Stops every NLB started by [`tests_start_client_routes_nlbs`].
#[napi]
pub async fn tests_stop_client_routes_nlbs() {
    stop_running_nlbs().await;
}

async fn stop_running_nlbs() {
    let previous = std::mem::take(&mut *running_nlbs().lock().await);
    for nlb in previous {
        nlb.finish().await;
    }
}
