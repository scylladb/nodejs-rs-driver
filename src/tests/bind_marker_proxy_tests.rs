//! Narrow controls for prepared bind-marker integration tests.
//!
//! scylla-proxy owns connections, frame transport, and error serialization. The
//! only response mutation changes a known marker name in this suite's PREPARED
//! metadata; it does not implement a second CQL transport in JavaScript.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use std::sync::{Arc, OnceLock};

use napi::Env;
use scylla_cql_core::frame::response::error::DbError;
use scylla_cql_core::frame::types::read_short_bytes;
use scylla_proxy::{
    Condition, Node, Proxy, Reaction, RequestOpcode, RequestReaction, RequestRule, ResponseFrame,
    ResponseOpcode, ResponseReaction, ResponseRule, RunningProxy, ShardAwareness,
    get_exclusive_local_address,
};
use tokio::runtime::{Builder, Runtime};
use tokio::sync::Mutex;

use crate::async_bridge::{BridgedPromise, JsAsyncResult};
use crate::errors::{ConvertedError, ConvertedResult, make_js_error};

const SPELLINGS: [&str; 3] = ["IN(ck)", "in(ck)", "items_after_upgrade"];

#[derive(Default)]
struct State {
    spelling: AtomicU8,
    prepares: AtomicU32,
    executes: AtomicU32,
    batches: AtomicU32,
    unprepared: AtomicU32,
    observed_spellings: AtomicU32,
}

struct Active {
    proxy: RunningProxy,
    runtime: OwnedRuntime,
    states: Vec<Arc<State>>,
}

// Keep all fixture workers in one scope, including workers spawned before
// Proxy::run returns an error. The runtime also stops these workers if startup
// is cancelled.
struct OwnedRuntime(Option<Runtime>);

impl OwnedRuntime {
    async fn shutdown(mut self) -> Result<(), String> {
        let runtime = self.0.take().expect("runtime is owned until shutdown");
        // Runtime::drop waits for its async workers to stop. It must run
        // outside the bridge's asynchronous context.
        tokio::task::spawn_blocking(move || drop(runtime))
            .await
            .map_err(|err| format!("Could not stop bind-marker proxy runtime: {err}"))
    }
}

impl Drop for OwnedRuntime {
    fn drop(&mut self) {
        if let Some(runtime) = self.0.take() {
            // Cancellation cannot await cleanup. Avoid dropping a runtime in
            // an async context while still requesting all workers to stop.
            runtime.shutdown_background();
        }
    }
}

static ACTIVE: OnceLock<Mutex<Option<Active>>> = OnceLock::new();

fn active() -> &'static Mutex<Option<Active>> {
    ACTIVE.get_or_init(|| Mutex::new(None))
}

fn error(err: impl std::fmt::Display) -> ConvertedError {
    ConvertedError::from(make_js_error(err.to_string()))
}

async fn start_proxy(nodes: Vec<Node>) -> Result<(RunningProxy, OwnedRuntime), String> {
    let runtime = OwnedRuntime(Some(
        Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .map_err(|err| format!("Could not create bind-marker proxy runtime: {err}"))?,
    ));
    let started = runtime
        .0
        .as_ref()
        .unwrap()
        .spawn(async move { Proxy::new(nodes).run().await })
        .await
        .map_err(|err| format!("Bind-marker proxy startup task failed: {err}"))
        .and_then(|result| result.map_err(|err| err.to_string()));
    match started {
        Ok(proxy) => Ok((proxy, runtime)),
        Err(err) => {
            runtime.shutdown().await?;
            Err(err)
        }
    }
}

fn request_rules(state: Arc<State>, fail_next_execute: bool) -> Vec<RequestRule> {
    let mut rules = Vec::new();
    if fail_next_execute {
        let state = state.clone();
        rules.push(RequestRule(
            Condition::RequestOpcode(RequestOpcode::Execute).and(Condition::TrueForLimitedTimes(1)),
            RequestReaction::forge_response(Arc::new(move |frame| {
                state.executes.fetch_add(1, Ordering::Relaxed);
                state.unprepared.fetch_add(1, Ordering::Relaxed);
                // EXECUTE begins with a [short bytes] prepared statement ID.
                // Use the real ID so the driver must take its reprepare path.
                let id = read_short_bytes(&mut &frame.body[..])
                    .expect("the driver sent a valid EXECUTE statement ID");
                ResponseFrame::forged_error(
                    frame.params,
                    DbError::Unprepared {
                        statement_id: id.to_vec().into(),
                    },
                    Some(""),
                )
                .expect("the EXECUTE statement ID fits in a protocol short")
            })),
        ));
    }
    rules.push(RequestRule(
        Condition::True,
        RequestReaction::transform_frame(Arc::new(move |frame| {
            let counter = match frame.opcode {
                RequestOpcode::Prepare => Some(&state.prepares),
                RequestOpcode::Execute => Some(&state.executes),
                RequestOpcode::Batch => Some(&state.batches),
                _ => None,
            };
            if let Some(counter) = counter {
                counter.fetch_add(1, Ordering::Relaxed);
            }
            frame
        })),
    ));
    rules
}

fn response_rules(state: Arc<State>) -> Vec<ResponseRule> {
    vec![ResponseRule(
        Condition::ResponseOpcode(ResponseOpcode::Result),
        ResponseReaction::transform_frame(Arc::new(move |mut frame| {
            if !frame.body.starts_with(&[0, 0, 0, 4]) {
                return frame;
            }
            // This suite uses protocol v4 and the fixed ck IN fixture. Skip the
            // prepared statement ID and replace only its known length-prefixed
            // metadata names. Other RESULT kinds and all other names pass through.
            let mut metadata = &frame.body[4..];
            if read_short_bytes(&mut metadata).is_err() {
                return frame;
            }
            let offset = frame.body.len() - metadata.len();
            let spelling = state.spelling.load(Ordering::Relaxed) as usize;
            let replacement = SPELLINGS[spelling].as_bytes();
            let mut body = frame.body[..offset].to_vec();
            let mut rest = metadata;
            let mut changed = false;
            while let Some(index) = rest
                .windows(8)
                .position(|bytes| bytes == b"\0\x06IN(ck)" || bytes == b"\0\x06in(ck)")
            {
                body.extend_from_slice(&rest[..index]);
                body.extend_from_slice(&(replacement.len() as u16).to_be_bytes());
                body.extend_from_slice(replacement);
                rest = &rest[index + 8..];
                changed = true;
            }
            if changed {
                body.extend_from_slice(rest);
                frame.body = body.into();
                state
                    .observed_spellings
                    .fetch_or(1 << spelling, Ordering::Relaxed);
            }
            frame
        })),
    )]
}

/// Starts one proxy per backend. Initial marker names alternate between IN(ck)
/// and in(ck).
/// Shared listener ports let discovered peer addresses use the same translator.
/// The process-global fixture permits only one active group of proxies.
#[napi(ts_return_type = "Promise<Array<string>>")]
pub fn tests_start_bind_marker_proxies(
    env: Env,
    backends: Vec<String>,
) -> JsAsyncResult<Vec<String>> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            let mut guard = active().lock().await;
            if guard.is_some() {
                return Err(error("Bind-marker proxies are already running"));
            }
            let mut nodes = Vec::new();
            let mut states = Vec::new();
            let mut addresses = Vec::new();
            // Validate every address before starting any listener.
            let backends: Vec<SocketAddr> = backends
                .into_iter()
                .map(|backend| {
                    backend
                        .parse()
                        .map_err(|err| error(format!("Invalid backend address {backend:?}: {err}")))
                })
                .collect::<ConvertedResult<_>>()?;
            for (index, backend) in backends.into_iter().enumerate() {
                let address = SocketAddr::new(get_exclusive_local_address(), backend.port());
                let state = Arc::new(State::default());
                state.spelling.store((index % 2) as u8, Ordering::Relaxed);
                nodes.push(Node::new(
                    backend,
                    address,
                    ShardAwareness::Unaware,
                    Some(request_rules(state.clone(), false)),
                    Some(response_rules(state.clone())),
                ));
                states.push(state);
                addresses.push(address.to_string());
            }
            let (proxy, runtime) = start_proxy(nodes).await.map_err(error)?;
            *guard = Some(Active {
                proxy,
                runtime,
                states,
            });
            ConvertedResult::Ok(addresses)
        })
    })
}

/// Changes this fixture's synthesized name and optionally injects one UNPREPARED.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_configure_bind_marker_proxy(
    env: Env,
    index: u32,
    spelling: String,
    fail_next_execute: bool,
) -> JsAsyncResult<()> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            let spelling = SPELLINGS
                .iter()
                .position(|candidate| *candidate == spelling)
                .ok_or_else(|| error("Unsupported bind-marker fixture spelling"))?;
            let mut guard = active().lock().await;
            let active = guard
                .as_mut()
                .ok_or_else(|| error("Bind-marker proxies are not running"))?;
            let state = active
                .states
                .get(index as usize)
                .ok_or_else(|| error("Invalid bind-marker proxy index"))?
                .clone();
            state.spelling.store(spelling as u8, Ordering::Relaxed);
            active.proxy.running_nodes[index as usize]
                .change_request_rules(Some(request_rules(state, fail_next_execute)));
            ConvertedResult::Ok(())
        })
    })
}

#[napi(object)]
pub struct BindMarkerProxyStats {
    pub prepares: u32,
    pub executes: u32,
    pub batches: u32,
    pub unprepared: u32,
    pub names: Vec<String>,
}

/// Returns request counts and rewritten metadata names for each proxy node.
#[napi(ts_return_type = "Promise<Array<BindMarkerProxyStats>>")]
pub fn tests_bind_marker_proxy_stats(env: Env) -> JsAsyncResult<Vec<BindMarkerProxyStats>> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            let guard = active().lock().await;
            let active = guard
                .as_ref()
                .ok_or_else(|| error("Bind-marker proxies are not running"))?;
            ConvertedResult::Ok(
                active
                    .states
                    .iter()
                    .map(|state| BindMarkerProxyStats {
                        prepares: state.prepares.load(Ordering::Relaxed),
                        executes: state.executes.load(Ordering::Relaxed),
                        batches: state.batches.load(Ordering::Relaxed),
                        unprepared: state.unprepared.load(Ordering::Relaxed),
                        names: SPELLINGS
                            .iter()
                            .enumerate()
                            .filter(|(index, _)| {
                                state.observed_spellings.load(Ordering::Relaxed) & (1 << index) != 0
                            })
                            .map(|(_, name)| (*name).to_owned())
                            .collect(),
                    })
                    .collect(),
            )
        })
    })
}

/// Stops all bind-marker proxies, including their existing connections.
#[napi(ts_return_type = "Promise<void>")]
pub fn tests_stop_bind_marker_proxies(env: Env) -> JsAsyncResult<()> {
    BridgedPromise::spawn(&env, || {
        Ok(async {
            if let Some(active) = active().lock().await.take() {
                drop(active.proxy);
                active.runtime.shutdown().await.map_err(error)?;
            }
            ConvertedResult::Ok(())
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[tokio::test]
    async fn rolls_back_an_earlier_listener_when_a_later_bind_fails() {
        let first_address = SocketAddr::new(get_exclusive_local_address(), 0);
        let reservation = TcpListener::bind(first_address).unwrap();
        let first_address = reservation.local_addr().unwrap();
        let second_address = SocketAddr::new(get_exclusive_local_address(), first_address.port());
        let blocker = TcpListener::bind(second_address).unwrap();
        let occupied_error = TcpListener::bind(second_address).unwrap_err();
        assert_eq!(occupied_error.kind(), std::io::ErrorKind::AddrInUse);
        drop(reservation);
        let nodes = || {
            [first_address, second_address]
                .into_iter()
                .map(|address| Node::new(address, address, ShardAwareness::Unaware, None, None))
                .collect()
        };

        let error = start_proxy(nodes())
            .await
            .err()
            .expect("second listener is occupied");
        assert!(error.contains(&second_address.to_string()), "{error}");
        assert!(error.contains(&occupied_error.to_string()), "{error}");
        // Proxy::run starts listeners in node order. Reaching the second bind
        // failure means the first listener was acquired successfully.
        // A bind, rather than a failed connection, proves the earlier listener
        // released the address after the failed multi-node startup.
        drop(TcpListener::bind(first_address).unwrap());
        drop(blocker);
        let (proxy, runtime) = start_proxy(nodes()).await.unwrap();
        assert_eq!(proxy.running_nodes.len(), 2);
        drop(proxy);
        runtime.shutdown().await.unwrap();
        drop(TcpListener::bind(first_address).unwrap());
        drop(TcpListener::bind(second_address).unwrap());
    }
}
