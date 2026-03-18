use std::{marker::PhantomData, rc::Rc};

use napi::{Env, Result, bindgen_prelude::check_status, sys};

/// Wrapper over napi_deferred pointer, that ensures safe usage of the pointer and prevents double resolve/reject.
pub(crate) struct DeferredPtr {
    ptr: sys::napi_deferred,
    // `napi_deferred` must only be used on the main Node.js thread.
    // `DeferredPtr` is intentionally !Send and !Sync to enforce that.
    _not_send_sync: PhantomData<Rc<()>>,
}

pub(crate) enum ResolveOrReject {
    Resolve,
    Reject,
}

impl DeferredPtr {
    /// # Safety
    /// The pointer must not have been resolved or rejected yet, and must point to a valid napi_deferred.
    pub(crate) unsafe fn new(ptr: sys::napi_deferred) -> Self {
        Self {
            ptr,
            _not_send_sync: PhantomData,
        }
    }

    /// # Safety
    /// Valid pointer to value must be provided
    pub(crate) unsafe fn resolve(
        self,
        env: Env,
        value: sys::napi_value,
        mode: ResolveOrReject,
    ) -> Result<()> {
        // We can use the napi_deferred only once, as per napi documentation,
        // any calls to resolve it, will free the value: https://nodejs.org/api/n-api.html#promises
        // While there is no specification what happens if the call fails, it's safer to assume
        // the pointer is no longer valid, and we are in non-recoverable state.

        // SAFETY: Constraints of this class ensure validity of the deref pointer,
        // and Env ensures validity of the napi_env.
        // Caller ensures validity of the value pointer.
        if let ResolveOrReject::Resolve = mode {
            unsafe { check_status!(sys::napi_resolve_deferred(env.raw(), self.ptr, value)) }
        } else {
            unsafe { check_status!(sys::napi_reject_deferred(env.raw(), self.ptr, value)) }
        }
    }
}
