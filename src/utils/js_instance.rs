use std::marker::PhantomData;

use napi::ValueType;
use napi::bindgen_prelude::{Object, ToNapiValue, TypeName};
use napi::sys;

/// A JavaScript `Object` handle statically tagged with the JS class `C` it is an instance of.
///
/// This is a thin, zero-overhead newtype over `Object<'env>`: the `C` type parameter carries no
/// runtime data and exists purely so that the Rust type system can tell apart from each other
/// a `JsInstance<'_, class::TableMetadata>` and `JsInstance<'_, class::ColumnMetadata>`, even
/// though at the N-API level both are just untyped `Object`s. Handing the wrong kind of JS object
/// to a function that expects a specific class therefore becomes a compile error.
///
/// The `'env` lifetime is inherited from the underlying `Object` and ties the handle to the N-API
/// handle scope it was obtained in, exactly like any other napi-rs JS value.
pub struct JsInstance<'env, C> {
    object: Object<'env>,
    _class: PhantomData<C>,
}

impl<'env, C> JsInstance<'env, C> {
    /// Tags an already-constructed `Object` as an instance of class `C`.
    /// The caller is responsible for ensuring `object` really is an instance of `C`.
    pub(crate) fn from_object(object: Object<'env>) -> Self {
        Self {
            object,
            _class: PhantomData,
        }
    }
}

impl<C> ToNapiValue for JsInstance<'_, C> {
    unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> napi::Result<sys::napi_value> {
        unsafe { ToNapiValue::to_napi_value(env, val.object) }
    }
}

impl<C> TypeName for JsInstance<'_, C> {
    fn type_name() -> &'static str {
        "Object"
    }

    fn value_type() -> ValueType {
        ValueType::Object
    }
}
