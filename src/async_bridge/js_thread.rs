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

// While check_status macro is doc(hidden), it implements a simple checks that convert c errors into Rust Results
// Implementation: https://github.com/napi-rs/napi-rs/blob/f2178312d0e3e07beecc19836b91716a229107d3/crates/napi/src/error.rs#L35
use napi::bindgen_prelude::{ToNapiValue, check_status};
use napi::{Env, Result, sys};

use super::shared::{CompletionQueue, DeferredPtr};
use super::worker;
use crate::errors::{ConvertedError, ConvertedResult};

/// FutureRegistry — one per N-API environment.
/// Futures run on the Tokio runtime. Each task carries its deferred,
/// and the drain settles it on the JavaScript thread.
pub(super) struct FutureRegistry {
    active_count: Cell<usize>,
    pub(super) queue: Arc<CompletionQueue>,
    tokio_rt: RefCell<Option<tokio::runtime::Runtime>>,
}

impl FutureRegistry {
    pub(super) fn new(rt: tokio::runtime::Runtime) -> Self {
        Self {
            active_count: Cell::new(0),
            queue: Arc::new(CompletionQueue::new()),
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

        // The task allocation happens here, on the JavaScript thread.
        // The task body runs on a Tokio worker.
        rt.spawn(worker::run_task(future, deferred, Arc::clone(&self.queue)));
        Ok(promise)
    }

    /// Called when the TSFN fires.
    pub(super) fn drain(&self, env: Env) {
        // Clear the flag before taking the batch. A push after the take
        // then signals the TSFN again, so no completion is lost.
        self.queue.signaled.store(false, Ordering::Release);
        let completed = std::mem::take(&mut *self.queue.completed.lock().unwrap());

        for settle in completed {
            // Conversion can invoke JavaScript, which may spawn another
            // future synchronously. No borrow is held here.
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
                        panic!("Failed to unref TSFN in drain: {}", e.reason);
                    }
                }
            }
        }
    }

    // This function is registered in the startup to be called during node cleanup process.
    pub(super) fn shutdown(&self) {
        self.active_count.set(0);
        *self.queue.tsfn.lock().unwrap() = None;
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
