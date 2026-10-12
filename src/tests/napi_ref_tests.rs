//! JS-side tests for `crate::utils::js_instance::JsInstance`, `crate::utils::napi_ref::NapiRef`
//! and the `define_js_ctor!` macro (`crate::utils::js_ctor`), exercised together through a
//! test-only `TestJsClass(name, value)` JS class (see `js_constructible_class::TestJsClass`).
use std::cell::RefCell;

use napi::Env;
use napi::bindgen_prelude::{FnArgs, Object, ToNapiValue};

use crate::errors::{ConvertedResult, JsResult, with_custom_error};
use crate::utils::js_ctor::{build_test_js_class, js_constructible_class};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;

thread_local! {
    /// Pins a `NapiRef` to the current thread, so we can test its behavior.
    static PINNED: RefCell<Option<NapiRef<js_constructible_class::TestJsClass>>> =
        const { RefCell::new(None) };
}

/// Builds a fresh `TestJsClass(name, value)` instance directly (via `define_js_ctor!`'s `build_fn`),
/// without pinning it.
#[napi(ts_return_type = "{ name: string, value: number }")]
pub fn tests_build_test_js_class<'env>(
    name: String,
    value: i32,
    env: &'env Env,
) -> JsResult<JsInstance<'env, js_constructible_class::TestJsClass>> {
    with_custom_error(|| {
        let instance = build_test_js_class(env, FnArgs::from((name.as_str(), value)))?;
        ConvertedResult::Ok(instance)
    })
}

/// Builds a `TestJsClass(name, value)` instance, pins it with a fresh `NapiRef`, and stores it in the
/// current thread's slot - replacing (and therefore dropping) whatever was previously stored.
#[napi(ts_return_type = "void")]
pub fn tests_pin_and_store(name: String, value: i32, env: Env) -> JsResult<()> {
    with_custom_error(|| {
        let instance = build_test_js_class(&env, FnArgs::from((name.as_str(), value)))?;
        let napi_ref = NapiRef::new(&env, instance)?;
        PINNED.with_borrow_mut(|slot| *slot = Some(napi_ref));
        ConvertedResult::Ok(())
    })
}

/// Returns the currently pinned instance (via `NapiRef::get`), or `None` if nothing is pinned.
/// Calling this twice in a row returns the same underlying JS object both times, proving the
/// `NapiRef` is pinning one specific object rather than the pinned data being rebuilt each call.
#[napi(ts_return_type = "{ name: string, value: number } | null")]
pub fn tests_get_pinned<'env>(
    env: &'env Env,
) -> JsResult<Option<JsInstance<'env, js_constructible_class::TestJsClass>>> {
    with_custom_error(|| {
        let raw = PINNED.with_borrow(|slot| match slot.as_ref() {
            Some(napi_ref) => {
                let instance = napi_ref.get(env)?;
                ConvertedResult::Ok(Some(unsafe {
                    ToNapiValue::to_napi_value(env.raw(), instance)
                }?))
            }
            None => ConvertedResult::Ok(None),
        })?;
        ConvertedResult::Ok(
            raw.map(|raw| JsInstance::from_object(Object::from_raw(env.raw(), raw))),
        )
    })
}

/// Drops whatever is currently pinned (if anything), releasing its underlying `napi_ref` with
/// `napi_delete_reference`.
#[napi]
pub fn tests_clear_pinned() {
    PINNED.with_borrow_mut(|slot| *slot = None);
}
