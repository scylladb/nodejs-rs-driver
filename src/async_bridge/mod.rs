//! Bridge between Rust futures and JavaScript Promises.
//!
//! # Why
//!
//! Async functions made with napi-rs settle each Promise through its own
//! thread-safe function (TSFN) call. This costs much CPU time on the
//! JavaScript thread, which is the bottleneck of the driver.
//! This bridge settles the Promises of many futures in one TSFN callback.
//!
//! # Architecture
//!
//! Each Node.js environment (the main thread or a worker thread) has its own:
//! - `FutureRegistry`, which lives only on the JavaScript thread,
//! - Tokio runtime with one worker thread,
//! - `CompletionQueue`, which both threads use,
//! - weak TSFN, which tokio threads use upon future completion to wake
//!   the JavaScript thread.
//!
//! ```text
//!  JavaScript thread                          Tokio worker thread
//!  ─────────────────                          ───────────────────
//!
//!  BridgedPromise::spawn(env, prepare)
//!   │ prepare()?  (sync work, can throw)
//!   │ ref the TSFN (if no futures pending)
//!   │ napi_create_promise ─► (deferred, promise)
//!   │ rt.spawn(run_task) ─────────────────────► run_task:
//!   ▼                                            │ result = fut.await
//!  return the promise to JavaScript              │ Box::new(settle closure)
//!                                                │   (captures result and deferred)
//!                                                ▼
//!                                         CompletionQueue::push
//!                                            │ completed.push(settle)
//!                                            │ if signaled was false:
//!                                            │   signaled = true
//!                                            │   TSFN.call()  ─────┐
//!                                            ▼                     │
//!                                           (done)                 │
//!                                                                  │
//!  TSFN callback ◄─────────────────────────────────────────────────┘
//!   │ FutureRegistry::drain:
//!   │   signaled = false
//!   │   batch = take(completed)
//!   │   for each settle in batch:
//!   │     settle(env)
//!   │       └─ convert the result to JS, resolve or reject
//!   │     if no futures pending: unref the TSFN
//!   ▼
//! ```
//!
//! Many futures can complete before the JavaScript thread runs the TSFN
//! callback. Only the first push after a drain calls the TSFN. So one
//! callback settles the whole batch.
//!
//! The drain clears `signaled` before it takes the batch. A push after the
//! take then calls the TSFN again, so no completion is lost.
//!
//! The TSFN is referenced only while futures are pending. So the bridge
//! keeps Node.js alive only until the last Promise settles.
//!
//! # What moves between the threads
//!
//! ```text
//!                 created on    travels through                   used on
//!  DeferredPtr    JS thread ───► Tokio task, then SettleCallback ───► JS thread (resolve / reject)
//!  SettleCallback worker    ───► CompletionQueue                 ───► JS thread (called, freed)
//! ```
//!
//! # Modules
//!
//! Each item runs on one kind of thread:
//! - `js_thread`: the JavaScript thread of an environment. It creates Promises,
//!   spawns futures, and settles the Promises in batches.
//! - `worker`: the Tokio worker threads. They run the futures and push the
//!   results to the completion queue.
//! - `shared`: the types that move between the two, or that both use.
//!
//! The public API in this file runs on the JavaScript thread.

mod js_thread;
mod shared;
mod worker;

use std::future::Future;
use std::marker::PhantomData;
use std::rc::Rc;
use std::sync::Arc;

use napi::bindgen_prelude::ToNapiValue;
use napi::{Env, Result, sys};
use napi_derive::napi;

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error};
use js_thread::{FutureRegistry, REGISTRIES};
use shared::CompletionQueue;

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
/// TSFN delivers batches of completed futures to the JavaScript thread.
/// It is ABI-stable, cross-platform, and has no direct libuv dependency.
#[napi(ts_return_type = "void")]
pub fn init_async_bridge(env: Env) -> JsResult<()> {
    with_custom_error(|| {
        let key = env.raw() as usize;
        if REGISTRIES.with(|registries| registries.borrow().contains_key(&key)) {
            return ConvertedResult::Ok(());
        }

        let queue = Arc::new(CompletionQueue::new());
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;
        let registry = Rc::new(FutureRegistry::new(rt, queue));

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
    /// Run a typed Rust future on this environment's Tokio runtime
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
            let fut = Box::pin(prepare()?);
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
