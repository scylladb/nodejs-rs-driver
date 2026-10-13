//! Types that both the JavaScript thread and the Tokio workers use.
//!
//! Each method says which thread calls it.

use std::sync::Mutex;
use std::sync::atomic::AtomicBool;

use napi::bindgen_prelude::check_status;
use napi::{Env, Result, Status, sys};

/// Wrapper over a `napi_deferred`: the handle that settles one Promise.
///
/// The JavaScript thread creates it. It then travels through a Tokio task
/// and comes back to the JavaScript thread, which settles it.
/// Only `resolve` and `reject` use the pointer. Both consume the wrapper,
/// so the deferred is settled at most once. Dropping it without settling
/// leaks the deferred: Node-API frees a deferred only when it is settled.
pub(super) struct DeferredPtr(sys::napi_deferred);

// SAFETY: The pointer is used only by `resolve` and `reject`. They are unsafe,
// and their callers must run them on the JavaScript thread that owns the deferred.
unsafe impl Send for DeferredPtr {}

impl DeferredPtr {
    // We can use the napi_deferred only once. As per the napi documentation,
    // the call that settles it also frees it: https://nodejs.org/api/n-api.html#promises
    // There is no specification of what happens if the call fails. It is safer to assume
    // that the pointer is no longer valid, and that we are in a non-recoverable state.

    /// Runs on: the JavaScript thread.
    ///
    /// # Safety
    /// `ptr` must come from a successful `napi_create_promise` and must not be settled yet.
    pub(super) unsafe fn new(ptr: sys::napi_deferred) -> Self {
        Self(ptr)
    }

    /// Runs on: the JavaScript thread.
    ///
    /// # Safety
    /// Call this only on the JavaScript thread of the environment that created
    /// the deferred. `value` must be a valid value of that environment.
    pub(super) unsafe fn resolve(self, env: Env, value: sys::napi_value) -> Result<()> {
        // SAFETY: The caller guarantees the thread and the value. The deferred
        // was not settled yet, because settling consumes the wrapper.
        unsafe { check_status!(sys::napi_resolve_deferred(env.raw(), self.0, value)) }
    }

    /// Runs on: the JavaScript thread.
    ///
    /// # Safety
    /// Call this only on the JavaScript thread of the environment that created
    /// the deferred. `value` must be a valid value of that environment.
    pub(super) unsafe fn reject(self, env: Env, value: sys::napi_value) -> Result<()> {
        // SAFETY: The same as in `resolve`.
        unsafe { check_status!(sys::napi_reject_deferred(env.raw(), self.0, value)) }
    }
}

/// Settles one Promise. It holds the result of the future and the deferred.
///
/// The JavaScript thread calls and frees it, either directly or in a
/// drain, or shutdown drops it. Boxing lets storage hold different result types.
pub(super) type SettleCallback = Box<dyn FnOnce(Env) + Send>;

/// A signal to drain coalesced completions. The TSFN never owns results:
/// napi-rs can discard notifications on shutdown without dropping payloads.
pub(super) type Tsfn =
    napi::threadsafe_function::ThreadsafeFunction<(), (), (), Status, false, true>;

/// Completion queue of one environment.
///
/// Tokio workers push completed futures here (`push`, in the `worker` module).
/// A TSFN callback drains the queued completions on the JavaScript thread
/// (`FutureRegistry::drain`, in the `js_thread` module).
pub(super) struct CompletionQueue {
    pub(super) completed: Mutex<Vec<SettleCallback>>,
    /// Set by the first push after a drain. Cleared by the drain.
    pub(super) signaled: AtomicBool,
    /// The TSFN lives here (behind a Mutex) so it's reachable from any
    /// thread — including the Tokio worker threads that complete futures.
    /// Send and shutdown take this lock before the completion-storage lock.
    pub(super) tsfn: Mutex<Option<Tsfn>>,
}

impl CompletionQueue {
    /// Runs on: the JavaScript thread.
    pub(super) fn new() -> Self {
        Self {
            completed: Mutex::new(Vec::new()),
            signaled: AtomicBool::new(false),
            tsfn: Mutex::new(None),
        }
    }

    /// Runs on: the JavaScript thread, once, from `init_async_bridge`.
    pub(super) fn set_tsfn(&self, tsfn: Tsfn) {
        *self.tsfn.lock().unwrap() = Some(tsfn);
    }
}
