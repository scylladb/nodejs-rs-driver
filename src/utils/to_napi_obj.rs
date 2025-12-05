/// This macro creates a struct with a defined list of field,
/// that can be used as an return value to JS exposed function.
///
/// This struct implements ToNapiValue,
/// by creating a JS Objects with fields named corresponding to rust struct fields
/// This is done to keep both the Rust and JS conventions for naming variables.
/// Each of the fields is passed by value.
///
/// # Example
///
/// Calling this macro in a following way:
/// ```rust
/// define_rust_to_js_convertible_object!(
///     Example {
///         some_field, someField: bool,
///         other_field, otherField: i32
///     }
/// );
/// ```
///
/// Will create the following struct:
/// ```rust
/// struct Example {
///     some_field: bool,
///     other_field: i32,
/// }
/// ```
///
/// Which will create the following JS Object:
/// ```js
/// {someField: false, otherField: 42}
/// ```
macro_rules! define_rust_to_js_convertible_object {
    ($struct_name: ident{$($field_name:ident, $js_name:ident: $field_type:ty),*,}) => {
        pub struct $struct_name {
            $(
                pub $field_name: $field_type,
            )*
        }

        impl ::napi::bindgen_prelude::ToNapiValue for $struct_name {
            /// # Safety
            ///
            /// Valid pointer to napi env must be provided
            unsafe fn to_napi_value(
                env: ::napi::sys::napi_env,
                val: Self,
            ) -> ::napi::Result<napi::sys::napi_value> {
                let env = ::napi::Env::from_raw(env);
                let mut o = ::napi::bindgen_prelude::Object::new(&env)?;
                $(o.set_named_property(stringify!($js_name), val.$field_name)?;)*
                Ok(o.raw())
            }
        }

    };
}

pub(crate) use define_rust_to_js_convertible_object;
