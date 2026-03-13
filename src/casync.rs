#![deny(clippy::all)]
#![allow(clippy::arc_with_non_send_sync)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::CString;
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

use napi::bindgen_prelude::*;
use napi::sys;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;

use crate::errors::ConvertedError;

/// JsPromise — lightweight wrapper so #\[napi] fns can return a raw Promise
/// without lifetime issues (Object<'_> can't be returned from #\[napi] fns).
pub struct JsPromise<T>(sys::napi_value, PhantomData<T>);

impl<T> ToNapiValue for JsPromise<T> {
    unsafe fn to_napi_value(_: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        // SAFETY: `val.0` is the raw `napi_value` returned by `napi_create_promise`
        // on the same env; it remains valid for the lifetime of the current napi call.
        Ok(val.0)
    }
}
type SettleCallback = Box<dyn FnOnce(sys::napi_env, sys::napi_deferred) + Send>;
type BoxFuture = Pin<Box<dyn Future<Output = SettleCallback> + Send>>;

struct FutureEntry {
    future: BoxFuture,
    /// Raw deferred handle — resolved/rejected in `poll_woken` on the
    /// main thread where we have a valid `napi_env`.
    deferred: sys::napi_deferred,
    waker: Waker,
}

// ---------------------------------------------------------------------------
// WakerBridge — single Thread safe function, coalesced wake signals
// ---------------------------------------------------------------------------

type Tsfn = napi::threadsafe_function::ThreadsafeFunction<(), (), (), Status, false, true, 0>;

struct WakerBridge {
    woken_ids: Arc<Mutex<Vec<u64>>>,
    signaled: Arc<AtomicBool>,
    /// The TSFN lives here (behind a Mutex) so it's reachable from any
    /// thread — including the Tokio worker thread that fires wakers.
    tsfn: Mutex<Option<Tsfn>>,
}

impl WakerBridge {
    fn new() -> Self {
        Self {
            woken_ids: Arc::new(Mutex::new(Vec::new())),
            signaled: Arc::new(AtomicBool::new(false)),
            tsfn: Mutex::new(None),
        }
    }

    /// Set the TSFN after creation (called once from `init_poll_bridge`).
    fn set_tsfn(&self, tsfn: Tsfn) {
        *self.tsfn.lock().unwrap() = Some(tsfn);
    }

    /// Signal the TSFN if not already signaled.
    fn signal(&self) {
        if !self.signaled.swap(true, Ordering::AcqRel) {
            let guard = self.tsfn.lock().unwrap();
            if let Some(ref tsfn) = *guard {
                tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
            }
        }
    }

    /// Called from any thread by a Waker.
    fn wake(&self, future_id: u64) {
        let mut ids = self.woken_ids.lock().unwrap();
        ids.push(future_id);
        self.signal();
    }
}

/// Per-future waker internals
struct WakerInner {
    future_id: u64,
    bridge: Arc<WakerBridge>,
}

impl Wake for WakerInner {
    fn wake(self: Arc<Self>) {
        self.bridge.wake(self.future_id);
    }

    fn wake_by_ref(self: &Arc<Self>) {
        self.bridge.wake(self.future_id);
    }
}

/// FutureRegistry — thread-local, lives on the Node main thread
struct FutureRegistry {
    futures: HashMap<u64, FutureEntry>,
    next_id: u64,
    bridge: Arc<WakerBridge>,
    tokio_rt: Option<tokio::runtime::Runtime>,
}

impl FutureRegistry {
    fn new() -> Self {
        let bridge = Arc::new(WakerBridge::new());
        Self {
            futures: HashMap::new(),
            next_id: 0,
            bridge,
            tokio_rt: None,
        }
    }

    fn insert(
        &mut self,
        raw_env: sys::napi_env,
        future: BoxFuture,
        deferred: sys::napi_deferred,
    ) -> u64 {
        // println!("Inserting future with deferred {deferred:p}");
        let was_empty = self.futures.is_empty();

        let id = self.next_id;
        self.next_id += 1;

        let waker = Waker::from(Arc::new(WakerInner {
            future_id: id,
            bridge: Arc::clone(&self.bridge),
        }));

        self.futures.insert(
            id,
            FutureEntry {
                future,
                deferred,
                waker,
            },
        );

        // If this is the first outstanding future, ref the TSFN so Node
        // keeps its event loop alive until all futures have settled.
        if was_empty {
            let guard = self.bridge.tsfn.lock().unwrap();
            if let Some(ref tsfn) = *guard {
                // SAFETY: `raw_env` originates from `submit_future`, which is always
                // called on the Node main thread where the env is valid. `tsfn.raw()`
                // is a live handle because `set_tsfn` was called during `init_poll_bridge`.
                unsafe { sys::napi_ref_threadsafe_function(raw_env, tsfn.raw()) };
            }
        }

        // Schedule the mandatory first poll.
        self.bridge.wake(id);

        id
    }

    /// Called on the main thread when the TSFN fires.
    /// `raw_env` is valid only for this invocation (from the TSFN callback).
    fn poll_woken(&mut self, raw_env: sys::napi_env) {
        self.bridge.signaled.store(false, Ordering::Release);

        let woken: Vec<u64> = {
            let mut ids = self.bridge.woken_ids.lock().unwrap();
            std::mem::take(&mut *ids)
        };

        // Take-and-process: remove entries before polling so that a polled
        // future can register *new* futures without hitting RefCell deadlock.
        let entries: Vec<(u64, FutureEntry)> = woken
            .iter()
            .filter_map(|&id| self.futures.remove(&id).map(|e| (id, e)))
            .collect();

        // Enter the Tokio runtime context so tokio::net, tokio::time, etc.
        // register with the reactor when polled.
        let _guard = self.tokio_rt.as_ref().map(|rt| rt.enter());

        for (id, mut entry) in entries {
            let mut cx = Context::from_waker(&entry.waker);
            match entry.future.as_mut().poll(&mut cx) {
                Poll::Ready(settle_fn) => {
                    settle_fn(raw_env, entry.deferred);
                }
                Poll::Pending => {
                    self.futures.insert(id, entry);
                }
            }
        }

        // If every future has settled, unref the TSFN so Node can exit
        // naturally.  The check happens *after* all polls so that a future
        // completing synchronously and submitting a new future in its settle
        // callback won't cause a premature unref.
        if self.futures.is_empty() {
            let guard = self.bridge.tsfn.lock().unwrap();
            if let Some(ref tsfn) = *guard {
                // SAFETY: `raw_env` comes from the TSFN callback, which Node always
                // invokes on the main thread with a valid env. `tsfn.raw()` is live
                // because we hold the Mutex lock.
                unsafe { sys::napi_unref_threadsafe_function(raw_env, tsfn.raw()) };
            }
        }
    }

    fn shutdown(&mut self) {
        self.futures.clear();
        *self.bridge.tsfn.lock().unwrap() = None;
        if let Some(rt) = self.tokio_rt.take() {
            rt.shutdown_background();
        }
    }
}

thread_local! {
  static REGISTRY: RefCell<FutureRegistry> = RefCell::new(FutureRegistry::new());
}

#[napi(no_export)]
fn noop_callback() {
    // No-op callback for creating the ThreadsafeFunction.
}

fn create_promise(env: &Env) -> Result<(sys::napi_deferred, sys::napi_value)> {
    let mut deferred = ptr::null_mut();
    let mut promise= ptr::null_mut();
    // SAFETY: `raw_env` is taken from Env, which is guaranteed to be valid for the lifetime of the current napi call.
    let status = unsafe { sys::napi_create_promise(env.raw(), &mut deferred, &mut promise) };
    if status != sys::Status::napi_ok {
        return Err(Error::from_reason("napi_create_promise failed"));
    }
    Ok((deferred, promise))
}

/// Safety: must be called on the main thread with a valid `napi_env`.
unsafe fn reject_with_reason(env: sys::napi_env, deferred: sys::napi_deferred, reason: &str) {
    // We can unwrap in the second place, because the only case when Cstring::new can fail is when the string contains a null byte.
    let c_reason = CString::new(reason).unwrap_or_else(|_| CString::new("[Unknown error] Error message contained illegal null byte").unwrap());
    let mut msg: sys::napi_value = std::ptr::null_mut();
    let mut error: sys::napi_value = std::ptr::null_mut();

    // SAFETY: Caller guarantees `env` is a valid main-thread env and `deferred`
    // has not yet been resolved or rejected. `c_reason` is a valid C string kept
    // alive for the duration of these calls. `msg` is initialized by
    // `napi_create_string_utf8` before being passed to `napi_create_error`, and
    // `error` is initialized by `napi_create_error` before `napi_reject_deferred`.
    unsafe {
        sys::napi_create_string_utf8(
            env,
            c_reason.as_ptr(),
            c_reason.to_bytes().len() as isize,
            &mut msg,
        );
        sys::napi_create_error(env, ptr::null_mut(), msg, &mut error);
        sys::napi_reject_deferred(env, deferred, error);
    }
}

// ---------------------------------------------------------------------------
// NAPI exports
// ---------------------------------------------------------------------------

/// Initialise the direct-poll bridge.  Must be called once before any
/// bridged async function.
///
/// Creates a dedicated `multi_thread(1)` Tokio runtime whose single worker
/// thread drives the reactor (epoll/kqueue).  A single weak TSFN is used
/// as the cross-thread wake mechanism — ABI-stable, cross-platform, no
/// direct libuv dependency.
///
/// Panic handling: if the Tokio worker thread panics the process aborts.
/// This is the simplest strategy — no silent hangs, no orphaned promises.
#[napi]
pub fn init_poll_bridge(env: Env) -> Result<()> {
    // println!("Initializing poll bridge...");
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .map_err(|e| Error::from_reason(format!("tokio runtime init failed: {e}")))?;

    // Create the TSFN from a no-op C callback.
    // `build_callback` replaces the JS call — the noop is never invoked.
    let noop_fn = env.create_function::<(), ()>("pollBridgeNoop", noop_callback_c_callback)?;

    let tsfn = noop_fn
        .build_threadsafe_function::<()>()
        .weak::<true>()
        .build_callback(|ctx| {
            let raw_env = ctx.env.raw();
            REGISTRY.with(|r| {
                r.borrow_mut().poll_woken(raw_env);
            });
            Ok(())
        })?;

    REGISTRY.with(|r| {
        let mut reg = r.borrow_mut();
        reg.tokio_rt = Some(rt);
        reg.bridge.set_tsfn(tsfn);
    });

    // Cleanup hook — shut down the runtime when Node exits.
    env.add_env_cleanup_hook((), |_| {
        REGISTRY.with(|r| {
            r.borrow_mut().shutdown();
        });
    })?;

    Ok(())
}

/// Submit a typed Rust future to be polled directly by the Node event loop.
///
/// Like `submit_future`, but the future can return a typed value `T` on success
/// or an error `E` on failure. Both `T` and `E` are converted to JS values via
/// `ToNapiValue` on the main thread when the future settles.
///
/// The error type `E` should produce a JS Error object from `to_napi_value` so
/// that the rejection value is a proper error (e.g. `ConvertedError`).
pub fn submit_future<F, T, E>(env: &Env, fut: F) -> Result<JsPromise<T>>
where
    F: Future<Output = std::result::Result<T, E>> + Send + 'static,
    T: napi::bindgen_prelude::ToNapiValue + Send + 'static,
    E: Into<ConvertedError> + Send + 'static,
{
    let (deferred, promise) = create_promise(env)?;

    let boxed: BoxFuture = Box::pin(async move {
        let result = fut.await;
        Box::new(move |env, deferred| unsafe {
            // SAFETY: This closure is only ever invoked from `poll_woken`, which runs
            // on the Node main thread inside the TSFN callback — the only place where
            // `env` is a valid napi_env. `deferred` is consumed exactly once here,
            // satisfying the napi contract that each deferred is resolved or rejected
            // exactly once. `to_napi_value` receives the same valid `env`.
            let (js_val, resolve) = match result {
                Ok(val) => (T::to_napi_value(env, val), true),
                Err(err) => (ConvertedError::to_napi_value(env, err.into()), false),
            };
            match js_val {
                Ok(v) if resolve => {
                    sys::napi_resolve_deferred(env, deferred, v);
                }
                Ok(v) => {
                    sys::napi_reject_deferred(env, deferred, v);
                }
                Err(e) => reject_with_reason(env, deferred, e.reason.as_str()),
            }
        }) as SettleCallback
    });

    REGISTRY.with(|r| r.borrow_mut().insert(env.raw(), boxed, deferred));
    Ok(JsPromise(promise, PhantomData))
}
