/// This macro creates a struct with a defined list of field,
/// that can be used as an argument to JS exposed function.
///
/// Because user can provide an object with some of the fields unset,
/// all of the fields are wrapped into a Option<>.
/// This struct implements FromNapiValue,
/// by getting each of the fields by the struct name
/// after converting that name to camelCase.
/// This is done to keep both the Rust and JS conventions for naming variables.
/// Each of the fields is retrieved by value.
///
/// # Example
///
/// Calling this macro in a following way:
/// ```rust
/// define_js_to_rust_convertible_object!(
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
///     some_field: Option<bool>,
///     other_field: Option<i32>,
/// }
/// ```
///
/// Which can be passed from JS with the following Object:
/// ```js
/// {someField: false}
/// ```
///
/// and will be converted to:
/// ```rust
/// Example {some_field: Some(false), other_field: None}
/// ```
macro_rules! define_js_to_rust_convertible_object {
    ($struct_name: ident{$($field_name:ident, $js_name:ident: $field_type:ty),*,}) => {
        // The PartialEq and Eq are used only for testing purposes
        // If at some point those traits become a problem, feel free to remove them
        // Or update the macro to make them optional
        #[derive(Debug, PartialEq, Eq)]
        pub struct $struct_name {
            $(
                pub $field_name: Option<$field_type>,
            )*
        }
        impl ::napi::bindgen_prelude::FromNapiValue for $struct_name {
            /// # Safety
            ///
            /// Valid pointer to napi env must be provided
            unsafe fn from_napi_value(
                env: ::napi::sys::napi_env,
                napi_val: ::napi::sys::napi_value,
            ) -> ::napi::Result<Self> {
                // Caller of this function ensures a valid pointer to napi env is provided
                let o = unsafe { ::napi::bindgen_prelude::Object::from_napi_value(env, napi_val) }?;
                Ok($struct_name {
                    $(
                        $field_name: o.get::<$field_type>(stringify!($js_name))?,
                    )*
                })
            }
        }

    };
}

pub(crate) use define_js_to_rust_convertible_object;
