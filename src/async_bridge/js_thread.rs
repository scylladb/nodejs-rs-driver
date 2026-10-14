//! Code that runs only on the JavaScript thread of an environment.
//!
//! `FutureRegistry` holds `Cell`, `RefCell` and `Rc`, so the compiler
//! keeps it on this thread.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::ffi::CString;
use std::future::Future;
use std::ptr;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};

// While check_status macro is doc(hidden), it implements a simple checks that convert c errors into Rust Results
// Implementation: https://github.com/napi-rs/napi-rs/blob/f2178312d0e3e07beecc19836b91716a229107d3/crates/napi/src/error.rs#L35
use napi::bindgen_prelude::{ToNapiValue, check_status};
use napi::{Env, Result, sys};

use super::shared::{CompletionQueue, DeferredPtr, SettleCallback};
use super::worker;
use crate::errors::{ConvertedError, ConvertedResult};

// Settle immediately ready low-load futures without a worker handoff.
// Pending futures always share the completion queue to amortize JS callbacks.
const INLINE_POLL_THRESHOLD: usize = 8;
const MAX_COMPLETIONS_PER_DRAIN: usize = 1024;
const MAX_DRAIN_TIME: Duration = Duration::from_micros(50);
// Keep inexpensive snapshots together at moderate concurrency. A small count
// limit inserts refill microtasks ahead of older results still waiting to settle.
// The time budget still bounds callbacks that perform expensive conversions.
const HIGH_LOAD_THRESHOLD: usize = 256;
const HIGH_LOAD_MAX_DRAIN_TIME: Duration = Duration::from_millis(2);

/// FutureRegistry — one per N-API environment.
/// Low-load futures get one local poll before moving to Tokio if pending.
/// All settlement happens on the originating JavaScript thread.
pub(super) struct FutureRegistry {
    active_count: Cell<usize>,
    #[cfg(feature = "tests")]
    counters: Cell<[u64; 8]>,
    pub(super) queue: Arc<CompletionQueue>,
    pending: RefCell<std::vec::IntoIter<SettleCallback>>,
    tokio_rt: RefCell<Option<tokio::runtime::Runtime>>,
}

impl FutureRegistry {
    pub(super) fn new(rt: tokio::runtime::Runtime) -> Self {
        Self {
            active_count: Cell::new(0),
            #[cfg(feature = "tests")]
            counters: Cell::new([0; 8]),
            queue: Arc::new(CompletionQueue::new()),
            pending: RefCell::new(Vec::new().into_iter()),
            tokio_rt: RefCell::new(Some(rt)),
        }
    }

    /// The registry of `env`, if `init_async_bridge` ran for it.
    pub(super) fn get(env: &Env) -> Option<Rc<Self>> {
        let key = env.raw() as usize;
        REGISTRIES.with(|registries| registries.borrow().get(&key).cloned())
    }

    /// Spawn the future and return the promise it settles.
    ///
    /// The promise is created only after every fallible step except its own
    /// creation. So a failure never leaves an unsettled deferred behind.
    pub(super) fn spawn<F, T>(&self, env: &Env, future: F) -> Result<sys::napi_value>
    where
        F: Future<Output = ConvertedResult<T>> + Send + 'static,
        T: ToNapiValue + Send + 'static,
    {
        let runtime = self.tokio_rt.borrow();
        let rt = runtime
            .as_ref()
            .ok_or_else(|| napi::Error::from_reason("Async bridge is shut down"))?;

        // Ref before spawning the future. If this fails, no work is left
        // running behind a promise that could not be returned to JavaScript.
        let active_count = self.active_count.get();
        if active_count == 0 {
            let guard = self.queue.tsfn.lock().unwrap();
            let tsfn = guard
                .as_ref()
                .ok_or_else(|| napi::Error::from_reason("Async bridge is not initialized"))?;
            // SAFETY: Env guarantees a valid `napi_env` for the current call.
            unsafe { check_status!(sys::napi_ref_threadsafe_function(env.raw(), tsfn.raw()))? };
        }

        let (deferred, promise) = create_promise(env).inspect_err(|_| {
            // Undo the ref above, so a failed spawn does not keep Node.js alive.
            if active_count == 0 {
                let guard = self.queue.tsfn.lock().unwrap();
                if let Some(ref tsfn) = *guard {
                    // SAFETY: Env guarantees a valid `napi_env` for the current call.
                    // A failed unref leaves Node.js alive, but it is not unsafe,
                    // so we return the original error.
                    let _ = unsafe { sys::napi_unref_threadsafe_function(env.raw(), tsfn.raw()) };
                }
            }
        })?;

        self.active_count.set(active_count + 1);

        let poll_inline = active_count < INLINE_POLL_THRESHOLD;
        let mut future = Box::pin(future);
        if poll_inline {
            // A first poll can start I/O without waking a worker first. Never
            // wait for readiness here. Spawning after Pending guarantees a new
            // poll with Tokio's waker, including when the first poll self-woke.
            let ready = {
                let _guard = rt.enter();
                let mut cx = Context::from_waker(futures::task::noop_waker_ref());
                future.as_mut().poll(&mut cx)
            };
            if let Poll::Ready(result) = ready {
                #[cfg(feature = "tests")]
                self.count(0);
                // Conversion may synchronously submit another future.
                drop(runtime);
                self.complete(
                    *env,
                    Box::new(move |env| {
                        // SAFETY: Still on the originating JavaScript thread.
                        unsafe { settle(env, deferred, result) }
                    }),
                );
                return Ok(promise);
            }
            #[cfg(feature = "tests")]
            self.count(1);
        } else {
            #[cfg(feature = "tests")]
            self.count(2);
        }
        rt.spawn(worker::run_task(future, deferred, Arc::clone(&self.queue)));
        Ok(promise)
    }

    /// Called when the TSFN fires.
    pub(super) fn drain(&self, env: Env) {
        // Clear the flag before taking the batch. A push after the take
        // then signals the TSFN again, so no completion is lost.
        self.queue.signaled.store(false, Ordering::Release);
        let budget = if self.active_count.get() >= HIGH_LOAD_THRESHOLD {
            HIGH_LOAD_MAX_DRAIN_TIME
        } else {
            MAX_DRAIN_TIME
        };
        let (mut completed, queued_pending) = {
            let mut pending = self.pending.borrow_mut();
            let mut queued = self.queue.completed.lock().unwrap();
            if pending.len() == 0 {
                (std::mem::take(&mut *queued).into_iter(), false)
            } else {
                (std::mem::take(&mut *pending), !queued.is_empty())
            }
        };

        #[cfg(feature = "tests")]
        self.count(5);
        // One result cannot be preempted, so a clock read cannot affect it.
        let deadline = (completed.len() > 1).then(|| Instant::now() + budget);
        let mut count = 0;
        while let Some(settle) = completed.next() {
            self.complete(env, settle);
            count += 1;
            #[cfg(feature = "tests")]
            self.count(4);
            if count == MAX_COMPLETIONS_PER_DRAIN
                || (completed.len() != 0 && deadline.is_some_and(|t| Instant::now() >= t))
            {
                break;
            }
        }
        // Retain the original allocation and finish older results before taking
        // a newer worker snapshot. No copy, requeue, or second queue lock.
        let pending = completed.len() != 0 || queued_pending;
        *self.pending.borrow_mut() = completed;
        if pending {
            #[cfg(feature = "tests")]
            self.count(7);
            self.queue.signal();
        }
        #[cfg(feature = "tests")]
        {
            let mut counters = self.counters.get();
            counters[6] = counters[6].max(count as u64);
            self.counters.set(counters);
        }
    }

    fn complete(&self, env: Env, settle: SettleCallback) {
        // Conversion can invoke JavaScript and submit another future.
        settle(env);
        let remaining = self.active_count.get() - 1;
        self.active_count.set(remaining);
        if remaining == 0 {
            let guard = self.queue.tsfn.lock().unwrap();
            if let Some(ref tsfn) = *guard {
                // SAFETY: Env belongs to this registry's N-API environment.
                let status = unsafe {
                    check_status!(sys::napi_unref_threadsafe_function(env.raw(), tsfn.raw()))
                };
                if let Err(e) = status {
                    panic!("Failed to unref TSFN after completion: {}", e.reason);
                }
            }
        }
    }

    #[cfg(feature = "tests")]
    fn count(&self, index: usize) {
        let mut counters = self.counters.get();
        counters[index] += 1;
        self.counters.set(counters);
    }

    #[cfg(feature = "tests")]
    pub(super) fn stats(&self, reset: bool) -> Vec<f64> {
        let counters = self.counters.get();
        if reset {
            self.counters.set([0; 8]);
        }
        counters.into_iter().map(|n| n as f64).collect()
    }

    #[cfg(feature = "tests")]
    pub(super) fn pending_completions(&self) -> usize {
        self.pending.borrow().len() + self.queue.completed.lock().unwrap().len()
    }

    // This function is registered in the startup to be called during node cleanup process.
    pub(super) fn shutdown(&self) {
        self.active_count.set(0);
        let (tsfn, completed) = {
            let mut guard = self.queue.tsfn.lock().unwrap();
            let tsfn = guard.take();
            let completed = std::mem::take(&mut *self.queue.completed.lock().unwrap());
            (tsfn, completed)
        };
        // Release locks before dropping callbacks and their captured resources.
        drop((tsfn, completed));
        // A bounded drain can retain already-completed results locally.
        let pending = std::mem::take(&mut *self.pending.borrow_mut());
        drop(pending);
        if let Some(rt) = self.tokio_rt.borrow_mut().take() {
            rt.shutdown_background();
        }
    }
}

thread_local! {
    pub(super) static REGISTRIES: RefCell<HashMap<usize, Rc<FutureRegistry>>> = RefCell::new(HashMap::new());
}

/// Converts the result of a future to JavaScript and settles its Promise.
///
/// # Safety
/// Call this only on the JavaScript thread of `env`, which must be the
/// environment that created `deferred`.
pub(super) unsafe fn settle<T: ToNapiValue>(
    env: Env,
    deferred: DeferredPtr,
    result: ConvertedResult<T>,
) {
    // SAFETY: The caller guarantees the thread, so `env` is valid here.
    // `deferred` is consumed exactly once, satisfying the napi contract that
    // each deferred is resolved or rejected exactly once.
    let status = unsafe {
        match result {
            Ok(val) => match T::to_napi_value(env.raw(), val) {
                Ok(v) => deferred.resolve(env, v),
                Err(e) => reject_conversion_error(env, deferred, e),
            },
            Err(err) => match ConvertedError::to_napi_value(env.raw(), err) {
                Ok(v) => deferred.reject(env, v),
                Err(e) => reject_conversion_error(env, deferred, e),
            },
        }
    };

    match status {
        Ok(()) => {}
        // After `worker.terminate()`, the environment cannot call into JavaScript.
        // N-API calls then fail with `PendingException`, although no exception
        // is pending. No JavaScript can observe this Promise any more, so do not
        // settle it.
        // An exception from the conversion cannot cause this status here:
        // `reject_conversion_error` clears it before it settles the deferred.
        Err(e) if e.status == napi::Status::PendingException => {}
        Err(e) => panic!(
            "Failed to settle promise in TSFN callback. This may indicate either a bug in the driver or a severe runtime error.\nRoot cause:\n {}",
            e.reason
        ),
    }
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
    // SAFETY: napi_create_promise has just succeeded, so deferred is valid and not settled yet.
    Ok((unsafe { DeferredPtr::new(deferred) }, promise))
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
        deferred.reject(env, error)?;
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
            deferred.reject(env, exception)
        }
    } else {
        reject_with_reason(env, deferred, &error.reason)
    }
}
