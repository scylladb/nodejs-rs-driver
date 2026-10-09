use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::CString;
use std::future::Future;
use std::marker::PhantomData;
use std::pin::Pin;
use std::ptr;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};

// While check_status macro is doc(hidden), it implements a simple checks that convert c errors into Rust Results
// Implementation: https://github.com/napi-rs/napi-rs/blob/f2178312d0e3e07beecc19836b91716a229107d3/crates/napi/src/error.rs#L35
use napi::bindgen_prelude::{ToNapiValue, check_status};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::{Env, Result, Status, sys};
use napi_derive::napi;

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error_sync};
use crate::napi_helpers::{DeferredPtr, ResolveOrReject};

/// JsPromise — lightweight wrapper over the promise pointer that indicates the type used to resolve the promise
/// The promise can be either resolved with type T or rejected with any error value (`ConvertedError` when used with `submit_future`).
pub struct JsPromise<T>(sys::napi_value, PhantomData<T>);
pub type JsAsyncResult<T> = JsResult<JsPromise<T>>;

impl<T> ToNapiValue for JsPromise<T> {
    /// # Safety
    /// No constrains on safety. The unsafe is required by the trait.
    unsafe fn to_napi_value(_: sys::napi_env, val: Self) -> Result<sys::napi_value> {
        Ok(val.0)
    }
}

type SettleCallback = Box<dyn FnOnce(Env, DeferredPtr) + Send>;
type BridgedFuture = Pin<Box<dyn Future<Output = SettleCallback> + Send>>;

struct FutureEntry {
    future: BridgedFuture,
    /// Raw deferred handle — resolved/rejected in `poll_woken` on the
    /// main thread where we have a valid `napi_env`.
    deferred: DeferredPtr,
    waker: Waker,
}

/// No argument no return value, weak ThreadSafeFunction type.
type Tsfn = napi::threadsafe_function::ThreadsafeFunction<(), (), (), Status, false, true>;

/// Single Thread safe function, coalesced wake signals
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
            } // Else branches can happen only during shutdown
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

/// FutureRegistry — one per N-API environment, accessed on its JavaScript thread.
struct FutureRegistry {
    futures: RefCell<HashMap<u64, FutureEntry>>,
    next_id: Cell<u64>,
    active_count: Cell<usize>,
    bridge: Arc<WakerBridge>,
    tokio_rt: RefCell<Option<tokio::runtime::Runtime>>,
}

impl FutureRegistry {
    fn new(rt: tokio::runtime::Runtime) -> Self {
        let bridge = Arc::new(WakerBridge::new());
        Self {
            futures: RefCell::new(HashMap::new()),
            next_id: Cell::new(0),
            active_count: Cell::new(0),
            bridge,
            tokio_rt: RefCell::new(Some(rt)),
        }
    }

    fn insert(&self, env: &Env, future: BridgedFuture, deferred: DeferredPtr) -> Result<u64> {
        let active_count = self.active_count.get();

        // Ref before registering the future. If this fails, no work is left
        // queued behind a promise that could not be returned to JavaScript.
        if active_count == 0 {
            let guard = self.bridge.tsfn.lock().unwrap();
            let tsfn = guard
                .as_ref()
                .ok_or_else(|| napi::Error::from_reason("Poll bridge is not initialized"))?;
            // SAFETY: Env guarantees a valid `napi_env` for the current call.
            unsafe { check_status!(sys::napi_ref_threadsafe_function(env.raw(), tsfn.raw()))? };
        }

        let id = self.next_id.get();
        self.next_id.set(id + 1);

        let waker = Waker::from(Arc::new(WakerInner {
            future_id: id,
            bridge: Arc::clone(&self.bridge),
        }));

        self.futures.borrow_mut().insert(
            id,
            FutureEntry {
                future,
                deferred,
                waker,
            },
        );

        self.active_count.set(active_count + 1);

        // Schedule the mandatory first poll.
        self.bridge.wake(id);

        Ok(id)
    }

    /// Called on the environment's JavaScript thread when the TSFN fires.
    fn poll_woken(&self, env: Env) {
        self.bridge.signaled.store(false, Ordering::Release);

        let woken: Vec<u64> = {
            let mut ids = self.bridge.woken_ids.lock().unwrap();
            std::mem::take(&mut *ids)
        };

        // Release the map borrow before polling or converting values: conversion
        // can invoke JavaScript, which may submit another future synchronously.
        let entries: Vec<(u64, FutureEntry)> = {
            let mut futures = self.futures.borrow_mut();
            woken
                .iter()
                .filter_map(|&id| futures.remove(&id).map(|entry| (id, entry)))
                .collect()
        };

        // Enter the Tokio runtime context so tokio::net, tokio::time, etc.
        // register with the reactor when polled.
        let runtime = self.tokio_rt.borrow();
        let _guard = runtime.as_ref().map(|rt| rt.enter());

        for (id, mut entry) in entries {
            let mut cx = Context::from_waker(&entry.waker);
            match entry.future.as_mut().poll(&mut cx) {
                Poll::Ready(settle_fn) => {
                    settle_fn(env, entry.deferred);
                    let remaining = self.active_count.get() - 1;
                    self.active_count.set(remaining);
                    if remaining == 0 {
                        let guard = self.bridge.tsfn.lock().unwrap();
                        if let Some(ref tsfn) = *guard {
                            // SAFETY: Env belongs to this registry's N-API environment.
                            let status = unsafe {
                                check_status!(sys::napi_unref_threadsafe_function(
                                    env.raw(),
                                    tsfn.raw()
                                ))
                            };
                            if let Err(e) = status {
                                panic!("Failed to unref TSFN in poll_woken: {}", e.reason);
                            }
                        }
                    }
                }
                Poll::Pending => {
                    self.futures.borrow_mut().insert(id, entry);
                }
            }
        }
    }

    // This function is registered in the startup to be called during node cleanup process.
    fn shutdown(&self) {
        self.futures.borrow_mut().clear();
        self.active_count.set(0);
        *self.bridge.tsfn.lock().unwrap() = None;
        if let Some(rt) = self.tokio_rt.borrow_mut().take() {
            rt.shutdown_background();
        }
    }
}

thread_local! {
    static REGISTRIES: RefCell<HashMap<usize, Rc<FutureRegistry>>> = RefCell::new(HashMap::new());
}

fn create_promise(env: &Env) -> Result<(DeferredPtr, sys::napi_value)> {
    let mut deferred = ptr::null_mut();
    let mut promise = ptr::null_mut();
    // SAFETY: Env is guaranteed to be valid for the lifetime of the current N-API call.
    unsafe {
        check_status!(sys::napi_create_promise(
            env.raw(),
            &mut deferred,
            &mut promise
        ))?
    };
    // SAFETY: deferred is assigned to valid value in napi_create_promise call, that have just succeeded.
    // This promise had no chance to be resolved yet.
    let deferred_ptr = unsafe { DeferredPtr::new(deferred) };
    Ok((deferred_ptr, promise))
}

fn reject_with_reason(env: Env, deferred: DeferredPtr, reason: &str) -> Result<()> {
    // We can unwrap in the second place, because the only case when Cstring::new can fail is when the string contains a null byte.
    let c_reason = CString::new(reason).unwrap_or_else(|_| {
        CString::new("[Unknown error] Error message contained illegal null byte").unwrap()
    });
    let mut msg: sys::napi_value = std::ptr::null_mut();
    let mut error: sys::napi_value = std::ptr::null_mut();

    // SAFETY: Env guarantees a valid environment on its JavaScript thread.
    // Remaining arguments are created in this function and are valid for the whole duration.
    unsafe {
        check_status!(sys::napi_create_string_utf8(
            env.raw(),
            c_reason.as_ptr(),
            c_reason.to_bytes().len() as isize,
            &mut msg,
        ))?;
        check_status!(sys::napi_create_error(
            env.raw(),
            ptr::null_mut(),
            msg,
            &mut error
        ))?;
        deferred.resolve(env, error, ResolveOrReject::Reject)?;
    }
    Ok(())
}

fn reject_conversion_error(env: Env, deferred: DeferredPtr, error: napi::Error) -> Result<()> {
    let mut pending = false;
    // A JS constructor used by ToNapiValue may have thrown. Node-API cannot
    // create an error or settle a promise until that exception is cleared.
    // SAFETY: Env is valid on this environment's JavaScript thread, and pending is writable.
    unsafe { check_status!(sys::napi_is_exception_pending(env.raw(), &mut pending))? };
    if pending {
        let mut exception = ptr::null_mut();
        // SAFETY: Env is valid for this callback. The returned exception belongs
        // to this environment and is used once to reject its deferred promise.
        unsafe {
            check_status!(sys::napi_get_and_clear_last_exception(
                env.raw(),
                &mut exception
            ))?;
            deferred.resolve(env, exception, ResolveOrReject::Reject)
        }
    } else {
        reject_with_reason(env, deferred, &error.reason)
    }
}

#[napi(no_export)]
fn noop_callback() {
    // No-op callback for creating the ThreadsafeFunction.
}

/// Initialize the direct-poll bridge for this N-API environment. Calls from
/// the same environment after the first successful initialization do nothing.
///
/// Creates a dedicated `multi_thread(1)` Tokio runtime whose single worker
/// thread drives the reactor (epoll/kqueue). A single weak TSFN is used
/// as the cross-thread wake mechanism — ABI-stable, cross-platform, no
/// direct libuv dependency.
#[napi]
pub fn init_poll_bridge(env: Env) -> JsResult<()> {
    with_custom_error_sync(|| {
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
        let noop_fn = env.create_function::<(), ()>("pollBridgeNoop", noop_callback_c_callback)?;

        let tsfn = noop_fn
            .build_threadsafe_function::<()>()
            // We will manually ref/unref this tsfn based on whether we have outstanding futures.
            .weak::<true>()
            .build_callback(|ctx| {
                let env = ctx.env;
                let key = env.raw() as usize;
                let registry = REGISTRIES.with(|registries| registries.borrow().get(&key).cloned());
                if let Some(registry) = registry {
                    registry.poll_woken(env);
                }
                Ok(())
            })?;
        registry.bridge.set_tsfn(tsfn);

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

/// Submit a typed Rust future to be polled directly by the Node event loop.
///
/// Future can return a typed value `T` on success
/// or a `ConvertedError` on failure. Both `T` and `ConvertedError` are converted to JS values via
/// `ToNapiValue` on the main thread when the future settles.
pub fn submit_future<F, T>(env: &Env, fut: F) -> ConvertedResult<JsPromise<T>>
where
    F: Future<Output = std::result::Result<T, ConvertedError>> + Send + 'static,
    T: napi::bindgen_prelude::ToNapiValue + Send + 'static,
{
    let registry = REGISTRIES
        .with(|registries| registries.borrow().get(&(env.raw() as usize)).cloned())
        .ok_or_else(|| {
            ConvertedError::from(napi::Error::from_reason(
                "init_poll_bridge must be called before submit_future",
            ))
        })?;

    let (deferred, promise) = create_promise(env)?;

    let boxed: BridgedFuture = Box::pin(async move {
        let result = fut.await;
        Box::new(move |env: Env, deferred: DeferredPtr| unsafe {
            // SAFETY: This closure is only ever invoked from `poll_woken`, which runs
            // on the environment's JavaScript thread inside the TSFN callback - where
            // `env` is a valid napi_env. `deferred` is consumed exactly once here,
            // satisfying the napi contract that each deferred is resolved or rejected
            // exactly once. `to_napi_value` receives the same valid `env`.
            let (js_val, resolve) = match result {
                Ok(val) => (T::to_napi_value(env.raw(), val), ResolveOrReject::Resolve),
                Err(err) => (
                    ConvertedError::to_napi_value(env.raw(), err),
                    ResolveOrReject::Reject,
                ),
            };

            let status = match js_val {
                Ok(v) => deferred.resolve(env, v, resolve),
                Err(e) => reject_conversion_error(env, deferred, e),
            };

            if let Err(e) = status {
                panic!(
                    "Failed to settle promise in TSFN callback. This may indicate either a bug in the driver or a severe runtime error.\nRoot cause:\n {}",
                    e.reason
                );
            }
        }) as SettleCallback
    });

    registry.insert(env, boxed, deferred)?;
    Ok(JsPromise(promise, PhantomData))
}
