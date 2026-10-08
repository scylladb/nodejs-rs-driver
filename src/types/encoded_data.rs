use napi::{
    bindgen_prelude::{FromNapiValue, Uint8Array, check_status},
    sys,
};
use scylla::{
    cluster::metadata::{ColumnType, NativeType},
    errors::SerializationError,
    serialize::value::{BuiltinSerializationError, BuiltinSerializationErrorKind, SerializeValue},
};
use scylla_cql_core::serialize::row::SerializedValues;

use crate::errors::make_js_error;

enum MaybeUnsetNullableValue<T> {
    Value(T),
    Null,
    Unset,
}

pub struct EncodedValuesWrapper {
    inner: MaybeUnsetNullableValue<Vec<u8>>,
}

/// Owns the complete CQL value list before execution leaves the JS thread.
/// Buffer contents are read only while converting the N-API argument, so JS
/// can safely reuse or mutate the source buffers after the call returns.
pub struct SerializedValuesWrapper {
    pub(crate) inner: SerializedValues,
}

impl FromNapiValue for SerializedValuesWrapper {
    /// # Safety
    ///
    /// `env` and `napi_val` must be valid for this synchronous N-API call.
    unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> napi::Result<Self> {
        let mut is_array = false;
        check_status!(
            unsafe { sys::napi_is_array(env, napi_val, &mut is_array) },
            "Failed to inspect encoded values",
        )?;
        if !is_array {
            return Err(make_js_error(
                "Expected an array of encoded values".to_owned(),
            ));
        }
        let mut count = 0;
        check_status!(
            unsafe { sys::napi_get_array_length(env, napi_val, &mut count) },
            "Expected an array of encoded values",
        )?;

        let mut inner = SerializedValues::new();
        for index in 0..count {
            let mut element = std::ptr::null_mut();
            check_status!(
                unsafe { sys::napi_get_element(env, napi_val, index, &mut element) },
                "Failed to read encoded value",
            )?;

            let mut value_type = 0;
            check_status!(
                unsafe { sys::napi_typeof(env, element, &mut value_type) },
                "Failed to inspect encoded value",
            )?;

            let value = match value_type {
                sys::ValueType::napi_undefined => MaybeUnsetNullableValue::Unset,
                sys::ValueType::napi_null => MaybeUnsetNullableValue::Null,
                sys::ValueType::napi_object => {
                    let bytes: &[u8] = unsafe { <&[u8]>::from_napi_value(env, element) }
                        .map_err(|_| make_js_error("Expected a Buffer or Uint8Array".to_owned()))?;
                    MaybeUnsetNullableValue::Value(bytes)
                }
                _ => {
                    return Err(make_js_error(
                        "Expected a Buffer, null or undefined".to_owned(),
                    ));
                }
            };
            inner
                .add_value(
                    &EncodedValueRef(value),
                    &ColumnType::Native(NativeType::Blob),
                )
                .map_err(|err| make_js_error(err.to_string()))?;
        }

        Ok(Self { inner })
    }
}

struct EncodedValueRef<'a>(MaybeUnsetNullableValue<&'a [u8]>);

impl SerializeValue for EncodedValueRef<'_> {
    fn serialize<'b>(
        &self,
        typ: &ColumnType,
        writer: scylla::serialize::writers::CellWriter<'b>,
    ) -> Result<scylla::serialize::writers::WrittenCellProof<'b>, SerializationError> {
        serialize_preencoded::<Self>(&self.0, typ, writer)
    }
}

fn serialize_preencoded<'b, T>(
    value: &MaybeUnsetNullableValue<&[u8]>,
    typ: &ColumnType,
    writer: scylla::serialize::writers::CellWriter<'b>,
) -> Result<scylla::serialize::writers::WrittenCellProof<'b>, SerializationError> {
    match value {
        MaybeUnsetNullableValue::Value(bytes) => writer
            .set_value(bytes)
            .map_err(|_| mk_ser_err::<T>(typ, BuiltinSerializationErrorKind::SizeOverflow)),
        MaybeUnsetNullableValue::Null => Ok(writer.set_null()),
        MaybeUnsetNullableValue::Unset => Ok(writer.set_unset()),
    }
}
fn mk_ser_err<T: ?Sized>(
    got: &ColumnType,
    kind: impl Into<BuiltinSerializationErrorKind>,
) -> SerializationError {
    mk_ser_err_named(std::any::type_name::<T>(), got, kind)
}

fn mk_ser_err_named(
    name: &'static str,
    got: &ColumnType,
    kind: impl Into<BuiltinSerializationErrorKind>,
) -> SerializationError {
    SerializationError::new(BuiltinSerializationError {
        rust_name: name,
        got: got.clone().into_owned(),
        kind: kind.into(),
    })
}

impl SerializeValue for EncodedValuesWrapper {
    fn serialize<'b>(
        &self,
        typ: &scylla::cluster::metadata::ColumnType,
        writer: scylla::serialize::writers::CellWriter<'b>,
    ) -> Result<scylla::serialize::writers::WrittenCellProof<'b>, scylla::errors::SerializationError>
    {
        let value = match &self.inner {
            MaybeUnsetNullableValue::Value(inner) => {
                MaybeUnsetNullableValue::Value(inner.as_slice())
            }
            MaybeUnsetNullableValue::Null => MaybeUnsetNullableValue::Null,
            MaybeUnsetNullableValue::Unset => MaybeUnsetNullableValue::Unset,
        };
        serialize_preencoded::<Self>(&value, typ, writer)
    }
}

impl FromNapiValue for EncodedValuesWrapper {
    /// # Safety
    ///
    /// Valid pointer to napi env must be provided
    unsafe fn from_napi_value(
        env: napi::sys::napi_env,
        napi_val: napi::sys::napi_value,
    ) -> napi::Result<Self> {
        let mut val_type: i32 = 0;
        // While this macro is doc(hidden), it implements a simple checks that convert c errors into Rust Results
        // Implementation: https://github.com/napi-rs/napi-rs/blob/f2178312d0e3e07beecc19836b91716a229107d3/crates/napi/src/error.rs#L357
        check_status!(
            // Caller of this function ensures a valid pointer to napi env is provided
            unsafe { sys::napi_typeof(env, napi_val, &mut val_type) },
            "Failed to convert napi value into rust type `EncodedValuesWrapper`",
        )?;

        // JS `undefined` is mapped to Unset
        // JS `null` is mapped to Null
        // Any other value will be encoded by the JS encoder
        match val_type {
            sys::ValueType::napi_undefined => Ok(EncodedValuesWrapper {
                inner: MaybeUnsetNullableValue::Unset,
            }),
            sys::ValueType::napi_null => Ok(EncodedValuesWrapper {
                inner: MaybeUnsetNullableValue::Null,
            }),
            sys::ValueType::napi_object => {
                // Caller of this function ensures a valid pointer to napi env is provided
                let v = unsafe { Uint8Array::from_napi_value(env, napi_val)? };
                let z: &[u8] = &v;
                Ok(EncodedValuesWrapper {
                    inner: MaybeUnsetNullableValue::Value(z.to_vec()),
                })
            },
            _ => Err(make_js_error(
                "Expected value to be either `Buffer`, `null` or `undefined` when converting to `EncodedValuesWrapper`".to_owned(),
            )),
        }
    }
}
