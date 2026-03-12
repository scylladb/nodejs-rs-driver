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

// While check_status macro is doc(hidden), it implements a simple checks that convert c errors into Rust Results
// Implementation: https://github.com/napi-rs/napi-rs/blob/f2178312d0e3e07beecc19836b91716a229107d3/crates/napi/src/error.rs#L35
use napi::bindgen_prelude::{ToNapiValue, check_status};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::{Env, Error, Result, Status, sys};
use napi_derive::napi;

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error_sync};

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

type SettleCallback = Box<dyn FnOnce(Env, sys::napi_deferred) + Send>;
type BridgedFuture = Pin<Box<dyn Future<Output = SettleCallback> + Send>>;

struct FutureEntry {
    future: BridgedFuture,
    /// Raw deferred handle — resolved/rejected in `poll_woken` on the
    /// main thread where we have a valid `napi_env`.
    deferred: sys::napi_deferred,
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

/// FutureRegistry — thread-local, lives on the Node main thread
struct FutureRegistry {
    futures: HashMap<u64, FutureEntry>,
    next_id: u64,
    bridge: Arc<WakerBridge>,
    tokio_rt: Option<tokio::runtime::Runtime>,
}

static INITIALIZED: AtomicBool = AtomicBool::new(false);
static INITIALIZATION_STARTED: AtomicBool = AtomicBool::new(false);

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
        env: &Env,
        future: BridgedFuture,
        deferred: sys::napi_deferred,
    ) -> Result<u64> {
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
                // SAFETY: Env guarantees a valid `napi_env` for the current call.
                unsafe { check_status!(sys::napi_ref_threadsafe_function(env.raw(), tsfn.raw()))? };
            } // Else branches can happen only during shutdown
        }

        // Schedule the mandatory first poll.
        self.bridge.wake(id);

        Ok(id)
    }

    /// Called on the main thread when the TSFN fires.
    /// `raw_env` is valid only for this invocation (from the TSFN callback).
    fn poll_woken(&mut self, env: Env) {
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
                    settle_fn(env, entry.deferred);
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
                // SAFETY: Env guarantees a valid `napi_env` for the current call.
                //  `tsfn.raw()` is live because we hold the Mutex lock.
                let status = unsafe {
                    check_status!(sys::napi_unref_threadsafe_function(env.raw(), tsfn.raw()))
                };
                if let Err(e) = status {
                    // We should fail here only in extreme cases (e.g. TSFN already unrefed, env invalid, etc.) — panic is warranted.
                    panic!(
                        "Failed to unref TSFN in poll_woken. This may indicate either a bug in the driver or a severe runtime error.\nRoot cause:\n {}",
                        e.reason
                    );
                }
            }
        }
    }

    // This function is registered in the startup to be called during node cleanup process.
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

fn create_promise(env: &Env) -> Result<(sys::napi_deferred, sys::napi_value)> {
    let mut deferred = ptr::null_mut();
    let mut promise = ptr::null_mut();
    // SAFETY: `raw_env` is taken from Env, which is guaranteed to be valid for the lifetime of the current napi call.
    unsafe {
        check_status!(sys::napi_create_promise(
            env.raw(),
            &mut deferred,
            &mut promise
        ))?
    };
    Ok((deferred, promise))
}

/// # Safety
/// The deferred must not have been resolved or rejected yet
unsafe fn reject_with_reason(env: Env, deferred: sys::napi_deferred, reason: &str) -> Result<()> {
    // We can unwrap in the second place, because the only case when Cstring::new can fail is when the string contains a null byte.
    let c_reason = CString::new(reason).unwrap_or_else(|_| {
        CString::new("[Unknown error] Error message contained illegal null byte").unwrap()
    });
    let mut msg: sys::napi_value = std::ptr::null_mut();
    let mut error: sys::napi_value = std::ptr::null_mut();

    // SAFETY: Env guarantees that raw pointer is a valid main-thread env and
    // caller ensured that `deferred` has not yet been resolved or rejected.
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
        check_status!(sys::napi_reject_deferred(env.raw(), deferred, error))?;
    }
    Ok(())
}

#[napi(no_export)]
fn noop_callback() {
    // No-op callback for creating the ThreadsafeFunction.
}

/// Initialize the direct-poll bridge.  Must be called once before any
/// bridged async function. This function must be called only once.
///
/// Creates a dedicated `multi_thread(1)` Tokio runtime whose single worker
/// thread drives the reactor (epoll/kqueue). A single weak TSFN is used
/// as the cross-thread wake mechanism — ABI-stable, cross-platform, no
/// direct libuv dependency.
#[napi]
pub fn init_poll_bridge(env: Env) -> JsResult<()> {
    with_custom_error_sync(|| {
        if INITIALIZATION_STARTED.swap(true, Ordering::SeqCst) {
            // We are very unlikely to recover from startup failure.
            // This means we do not worry about allowing to re-call this function on failure.
            return Err(Error::from_reason(
                "init_poll_bridge can only be called once",
            ));
        }

        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()?;

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
                let raw_env = ctx.env;
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

        INITIALIZED.store(true, Ordering::SeqCst);

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
    // This is a driver error, so panic is warranted here. There is no reasonable way to recover.
    assert!(
        INITIALIZED.load(Ordering::Relaxed),
        "init_poll_bridge must be called before submit_future. This is a bug in the driver."
    );

    let (deferred, promise) = create_promise(env)?;

    let boxed: BridgedFuture = Box::pin(async move {
        let result = fut.await;
        Box::new(move |env: Env, deferred| unsafe {
            // SAFETY: This closure is only ever invoked from `poll_woken`, which runs
            // on the Node main thread inside the TSFN callback - the only place where
            // `env` is a valid napi_env. `deferred` is consumed exactly once here,
            // satisfying the napi contract that each deferred is resolved or rejected
            // exactly once. `to_napi_value` receives the same valid `env`.
            let (js_val, resolve) = match result {
                Ok(val) => (T::to_napi_value(env.raw(), val), true),
                Err(err) => (ConvertedError::to_napi_value(env.raw(), err), false),
            };
            let status = js_val
                // First we try to accept / reject with converted value / error.
                .and_then(|v| {
                    if resolve {
                        check_status!(sys::napi_resolve_deferred(env.raw(), deferred, v))
                    } else {
                        check_status!(sys::napi_reject_deferred(env.raw(), deferred, v))
                    }
                })
                // If this fails, or we failed to convert the value / error into a JS value,
                // we reject with a fallback reason.
                .or_else(|e| reject_with_reason(env, deferred, &e.reason));

            if let Err(e) = status {
                // If both fail, we assume something terrible has happened. We cannot
                // inform JS side about the error by regular error handling, so we panic to
                // avoid silent failures and orphaned promises.
                panic!(
                    "Failed to settle promise in TSFN callback. This may indicate either a bug in the driver or a severe runtime error.\nRoot cause:\n {}",
                    e.reason
                );
            }
        }) as SettleCallback
    });

    REGISTRY.with(|r| r.borrow_mut().insert(env, boxed, deferred))?;
    Ok(JsPromise(promise, PhantomData))
}
