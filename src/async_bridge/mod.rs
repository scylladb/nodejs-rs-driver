//! Bridge between Rust futures and JavaScript Promises.
//!
//! # Scheduling paths
//!
//! Each Node.js environment owns one Tokio runtime, one completion queue, and
//! one weak thread-safe function (TSFN). The number of outstanding futures at
//! submission selects a path; no timer waits for a batch to fill.
//!
//! With fewer than eight outstanding futures, the bridge polls once on the
//! JavaScript thread, inside the Tokio runtime context. A ready future settles
//! immediately; its Promise reactions still run asynchronously. A pending future
//! moves to Tokio, which polls it with its own waker. Its eventual completion
//! joins the shared queue, whose notifications are coalesced at every load.
//!
//! At higher concurrency, Tokio performs all future polling. Workers enqueue
//! completion callbacks, and only the first enqueue after a drain signals the
//! TSFN. Each drain handles at most 1024 results. With fewer than 256 outstanding
//! futures, the time budget is 50 microseconds; at 256 or more, it is 2 milliseconds.
//! Cheap moderate-load snapshots stay together instead of putting refill work
//! ahead of older results. Unfinished snapshots remain on the JavaScript thread,
//! and Promise reactions can run between chunks. Time limits are soft: a single
//! conversion cannot be preempted. A one-result snapshot needs no clock check.
//!
//! ```text
//! JavaScript submission
//!   |
//!   +-- fewer than 8 pending --> first poll
//!   |                            +-- Ready --> settle Promise
//!   |                            +-- Pending --> Tokio --> completion queue --> TSFN drain
//!   |
//!   +-- 8 or more pending --> Tokio --> completion queue --> bounded TSFN drain
//! ```
//!
//! The selection belongs to each submitted future. A burst can have both polling paths
//! in flight; when it subsides, new requests automatically use the
//! low-load path. There is no process-wide mode or application configuration.
//!
//! # Lifetime and wakeups
//!
//! The TSFN is referenced while futures are outstanding, keeping Node.js alive
//! until the last Promise settles. Deferred handles travel through Rust as
//! opaque pointers and are used only on the originating JavaScript thread.
//!
//! The drain clears `signaled` before taking a batch. A worker pushing after the
//! take therefore schedules another callback. A bounded drain retains its remainder
//! ahead of newer completions and signals again if no wakeup is pending. Locks
//! and registry borrows are released before conversion, which can invoke JS and
//! submit another future synchronously.
//!
//! # Modules
//!
//! - `js_thread`: Promise creation, first polling, inline settlement, and drains.
//! - `worker`: Tokio execution and queued completion delivery.
//! - `shared`: types passed between the threads.

mod js_thread;
mod shared;
mod worker;

use std::future::Future;
use std::marker::PhantomData;
use std::rc::Rc;

use napi::bindgen_prelude::ToNapiValue;
use napi::{Env, Result, sys};
use napi_derive::napi;

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error};
use js_thread::{FutureRegistry, REGISTRIES};

/// A JS Promise that a future on the bridge's Tokio runtime settles.
/// `T` is the type the Promise resolves with. The Promise rejects with any error value
/// (`ConvertedError` when created by [`BridgedPromise::spawn`]).
pub struct BridgedPromise<T>(sys::napi_value, PhantomData<T>);
pub type JsAsyncResult<T> = JsResult<BridgedPromise<T>>;

impl<T> ToNapiValue for BridgedPromise<T> {
    /// # Safety
    /// No constrains on safety. The unsafe is required by the trait.
    unsafe fn to_napi_value(_: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        Ok(val.0)
    }
}

#[napi(no_export)]
fn noop_callback() {
    // No-op callback for creating the ThreadsafeFunction.
}

/// Initialize the async bridge for this N-API environment. Calls from
/// the same environment after the first successful initialization do nothing.
///
/// Creates a dedicated `multi_thread(1)` Tokio runtime. Its worker thread runs
/// the spawned futures and drives the reactor (epoll/kqueue). A single weak
/// TSFN delivers bounded batches of completions to the JavaScript thread.
/// It is ABI-stable, cross-platform, and has no direct libuv dependency.
#[napi(ts_return_type = "void")]
pub fn init_async_bridge(env: Env) -> JsResult<()> {
    with_custom_error(|| {
        let key = env.raw() as usize;
        if REGISTRIES.with(|registries| registries.borrow().contains_key(&key)) {
            return ConvertedResult::Ok(());
        }

        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let registry = Rc::new(FutureRegistry::new(rt));

        // Create the TSFN from any c callback. This callback will be replaced in the build_callback step,
        // but we still need to provide c function, to use napi-rs callback builder.
        // We could do this directly through node-api interface, but here napi-rs simplifies this process.
        // We also have to use callback with matching type, to ensure everything runs correctly.
        let noop_fn = env.create_function::<(), ()>("asyncBridgeNoop", noop_callback_c_callback)?;

        let tsfn = noop_fn
            .build_threadsafe_function::<()>()
            // We will manually ref/unref this tsfn based on whether we have outstanding futures.
            .weak::<true>()
            .build_callback(|ctx| {
                let env = ctx.env;
                if let Some(registry) = FutureRegistry::get(&env) {
                    registry.drain(env);
                }
                Ok(())
            })?;
        registry.queue.set_tsfn(tsfn);

        // Cleanup hook — shut down the runtime when Node exits.
        env.add_env_cleanup_hook(key, |key| {
            REGISTRIES.with(|registries| {
                let registry = registries.borrow_mut().remove(&key);
                if let Some(registry) = registry {
                    registry.shutdown();
                }
            });
        })?;
        REGISTRIES.with(|registries| {
            registries.borrow_mut().insert(key, registry);
        });

        Ok(())
    })
}

impl<T> BridgedPromise<T>
where
    T: ToNapiValue + Send + 'static,
{
    /// Run a typed Rust future through this environment's adaptive bridge
    /// and return the Promise that the future settles.
    ///
    /// `prepare` runs synchronously on the JavaScript thread. It can do fallible
    /// work with `?` (for example, convert arguments) and then returns the future.
    /// If `prepare` fails, the function throws and no Promise is created.
    ///
    /// The future can return a typed value `T` on success
    /// or a `ConvertedError` on failure. Both `T` and `ConvertedError` are converted to JS values via
    /// `ToNapiValue` on the main thread when the future settles.
    pub fn spawn<P, F>(env: &Env, prepare: P) -> JsAsyncResult<T>
    where
        P: FnOnce() -> ConvertedResult<F>,
        F: Future<Output = ConvertedResult<T>> + Send + 'static,
    {
        with_custom_error(|| {
            let fut = prepare()?;
            let registry = FutureRegistry::get(env).ok_or_else(|| {
                ConvertedError::from(napi::Error::from_reason(
                    "init_async_bridge must be called before BridgedPromise::spawn",
                ))
            })?;
            let promise = registry.spawn(env, fut)?;
            ConvertedResult::Ok(BridgedPromise(promise, PhantomData))
        })
    }
}

/// Read and optionally reset per-environment path counters for bridge tests.
#[cfg(feature = "tests")]
#[napi]
pub fn tests_bridge_stats(env: Env, reset: bool) -> Vec<f64> {
    FutureRegistry::get(&env).unwrap().stats(reset)
}

/// Number of queued results awaiting JS consumption, for shutdown tests.
#[cfg(feature = "tests")]
#[napi]
pub fn tests_bridge_pending_completions(env: Env) -> u32 {
    FutureRegistry::get(&env).unwrap().pending_completions() as u32
}

/// Force queued notifications to be discarded instead of dispatched during
/// termination. Node versions differ in whether they drain first.
#[cfg(feature = "tests")]
#[napi]
pub fn tests_bridge_abort_notifications(env: Env) -> Result<()> {
    let tsfn = FutureRegistry::get(&env)
        .unwrap()
        .queue
        .tsfn
        .lock()
        .unwrap()
        .take()
        .unwrap();
    // Releasing normally drains queued callbacks; this test needs abort.
    #[allow(deprecated)]
    tsfn.abort()
}
