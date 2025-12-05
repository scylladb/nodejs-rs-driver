use napi::{
    bindgen_prelude::{FromNapiValue, Uint8Array, check_status},
    sys,
};
use scylla::{
    cluster::metadata::ColumnType,
    errors::SerializationError,
    serialize::value::{BuiltinSerializationError, BuiltinSerializationErrorKind, SerializeValue},
};

use crate::errors::make_js_error;

enum MaybeUnsetNullableValue<T> {
    Value(T),
    Null,
    Unset,
}

pub struct EncodedValuesWrapper {
    inner: MaybeUnsetNullableValue<Vec<u8>>,
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
        match &self.inner {
            MaybeUnsetNullableValue::Value(inner) => writer
                .set_value(inner.as_ref())
                .map_err(|_| mk_ser_err::<Self>(typ, BuiltinSerializationErrorKind::SizeOverflow)),
            MaybeUnsetNullableValue::Null => Ok(writer.set_null()),
            MaybeUnsetNullableValue::Unset => Ok(writer.set_unset()),
        }
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
