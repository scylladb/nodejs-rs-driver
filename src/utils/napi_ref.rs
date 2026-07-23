use napi::Env;
use napi::bindgen_prelude::{Object, ToNapiValue, check_status};
use napi::sys;
use std::marker::PhantomData;
use std::ptr;

use crate::utils::js_instance::JsInstance;

/// A typed abstraction over a raw N-API owning a strong reference that pins a `JsInstance<C>`
/// The `C` type parameter records which JS class the pinned object is an instance of, so retrieving
/// it later yields a correctly-typed `JsInstance<'_, C>` rather than an untyped `Object`. `JsInstance`
/// is a plain JS object not wrapped as a napi-rs `#[napi]` class instance, so `Reference<T>` cannot be used.
///
/// Unlike a raw `napi_ref`, which has no `Drop` semantics of its own, `NapiRef` releases the reference
/// it owns automatically when dropped (`napi_reference_unref`, then `napi_delete_reference` once the
/// strong count reaches zero) - mirroring what napi-rs's own `Reference<T>` does for `#[napi]` class
/// instances.
///
/// # Safety
/// Every `NapiRef` must only be created, read, cloned, or dropped on the JS thread that owns the `Env` it was created with.
pub struct NapiRef<C> {
    napi_ref: sys::napi_ref,
    env: sys::napi_env,
    _class: PhantomData<C>,
}

impl<C> NapiRef<C> {
    /// Pins `value` (a `C` instance) against garbage collection with a fresh, strong (ref count 1)
    /// `napi_ref`, taking ownership of the reference's lifetime.
    pub(crate) fn new(env: &Env, value: JsInstance<'_, C>) -> napi::Result<Self> {
        let napi_val = unsafe { ToNapiValue::to_napi_value(env.raw(), value) }?;
        let mut napi_ref = ptr::null_mut();
        check_status!(
            unsafe { sys::napi_create_reference(env.raw(), napi_val, 1, &mut napi_ref) },
            "Failed to create N-API reference",
        )?;
        Ok(Self {
            napi_ref,
            env: env.raw(),
            _class: PhantomData,
        })
    }

    /// Retrieves the `C` instance currently pinned by this reference, as a `JsInstance<'env, C>`
    /// whose lifetime is tied to the borrow of `env` passed in - preventing the returned object
    /// from outliving the `Env` it was retrieved through. `env` must refer to the same environment
    /// this `NapiRef` was created with.
    pub(crate) fn get<'env>(&self, env: &'env Env) -> napi::Result<JsInstance<'env, C>> {
        debug_assert_eq!(
            self.env,
            env.raw(),
            "NapiRef::get called with an Env different from the one it was created with",
        );
        let mut result = ptr::null_mut();
        check_status!(
            unsafe { sys::napi_get_reference_value(self.env, self.napi_ref, &mut result) },
            "Failed to get N-API reference value",
        )?;
        Ok(JsInstance::from_object(Object::from_raw(env.raw(), result)))
    }

    /// Increments this reference's strong count and returns a new `NapiRef` pinning the same
    /// underlying `C` instance. The object is only actually released once every clone has been dropped.
    #[allow(dead_code)]
    pub(crate) fn try_clone(&self, env: &Env) -> napi::Result<Self> {
        debug_assert_eq!(
            self.env,
            env.raw(),
            "NapiRef::try_clone called with an Env different from the one it was created with",
        );
        let mut ref_count = 0;
        check_status!(
            unsafe { sys::napi_reference_ref(self.env, self.napi_ref, &mut ref_count) },
            "Failed to ref N-API reference",
        )?;
        Ok(Self {
            napi_ref: self.napi_ref,
            env: self.env,
            _class: PhantomData,
        })
    }
}

impl<C> Drop for NapiRef<C> {
    /// Releases this `napi_ref`'s strong count (`napi_reference_unref`), deleting the reference entirely
    /// (`napi_delete_reference`) once the count reaches zero. This runs on every `NapiRef` drop.
    fn drop(&mut self) {
        let mut ref_count = 0;
        let unref_status =
            unsafe { sys::napi_reference_unref(self.env, self.napi_ref, &mut ref_count) };
        debug_assert_eq!(
            unref_status,
            sys::Status::napi_ok,
            "Failed to unref N-API reference"
        );
        if ref_count == 0 {
            let delete_status = unsafe { sys::napi_delete_reference(self.env, self.napi_ref) };
            debug_assert_eq!(
                delete_status,
                sys::Status::napi_ok,
                "Failed to delete N-API reference"
            );
        }
    }
}
