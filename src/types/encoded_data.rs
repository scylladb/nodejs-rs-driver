use napi::{bindgen_prelude::FromNapiValue, sys};
use scylla::serialize::row::{
    BuiltinTypeCheckError, BuiltinTypeCheckErrorKind, RowSerializationContext, SerializeRow,
};
use scylla::serialize::writers::RowWriter;
use scylla::{
    cluster::metadata::ColumnType,
    errors::SerializationError,
    serialize::value::{BuiltinSerializationError, BuiltinSerializationErrorKind},
};
use scylla_cql_core::frame::types::{RawValue, read_short};
use scylla_cql_core::serialize::row::SerializedValues;

use crate::errors::make_js_error;

/// Owns the complete CQL value list before execution leaves the JS thread.
///
/// JS passes one buffer in the request frame layout:
/// `[u16 count]` followed by `count` values, each `[i32 length][bytes]`.
/// A length of -1 is null, and -2 is unset.
/// The bytes are copied while converting the N-API argument, so JS
/// can safely reuse or mutate the source buffer after the call returns.
///
/// This copy is required. The buffer is a view of the client's `FrameWriter` buffer,
/// and the next request overwrites it.
/// Thus, do not keep a reference to the JS buffer here, for example to avoid the copy.
pub struct SerializedValuesWrapper {
    pub(crate) inner: SerializedValues,
}

impl FromNapiValue for SerializedValuesWrapper {
    /// # Safety
    ///
    /// `env` and `napi_val` must be valid for this synchronous N-API call.
    unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> napi::Result<Self> {
        let frame: &[u8] = unsafe { <&[u8]>::from_napi_value(env, napi_val) }
            .map_err(|_| make_js_error("Expected encoded values in a Buffer".to_owned()))?;
        let mut rest = frame;
        let inner = SerializedValues::new_from_frame(&mut rest)
            .map_err(|err| make_js_error(format!("Malformed encoded values: {err}")))?;
        if !rest.is_empty() {
            return Err(make_js_error(format!(
                "Malformed encoded values: {} unexpected trailing bytes",
                rest.len()
            )));
        }
        Ok(Self { inner })
    }
}

/// The values of all statements of a batch, from one JS buffer:
/// `[u16 statement count]`, then one [`SerializedValuesWrapper`] frame per statement.
/// The bytes are copied while converting the N-API argument.
/// This copy is required for the same reason as in [`SerializedValuesWrapper`].
pub struct BatchValuesWrapper {
    pub(crate) rows: Vec<SerializedValuesWrapper>,
}

impl FromNapiValue for BatchValuesWrapper {
    /// # Safety
    ///
    /// `env` and `napi_val` must be valid for this synchronous N-API call.
    unsafe fn from_napi_value(env: sys::napi_env, napi_val: sys::napi_value) -> napi::Result<Self> {
        let frame: &[u8] = unsafe { <&[u8]>::from_napi_value(env, napi_val) }
            .map_err(|_| make_js_error("Expected encoded batch values in a Buffer".to_owned()))?;
        let mut rest = frame;
        let malformed = |err: &dyn std::fmt::Display| {
            make_js_error(format!("Malformed encoded batch values: {err}"))
        };
        let count = read_short(&mut rest).map_err(|err| malformed(&err))?;
        let rows = (0..count)
            .map(|_| {
                SerializedValues::new_from_frame(&mut rest)
                    .map(|inner| SerializedValuesWrapper { inner })
                    .map_err(|err| malformed(&err))
            })
            .collect::<napi::Result<Vec<_>>>()?;
        if !rest.is_empty() {
            return Err(malformed(&format_args!(
                "{} unexpected trailing bytes",
                rest.len()
            )));
        }
        Ok(Self { rows })
    }
}

/// Writes the pre-encoded values as they are.
/// Unprepared statements need this: the driver prepares them internally,
/// and then serializes the values against the column specs it received.
/// The values are not type checked here. The JS encoder already did that.
impl SerializeRow for SerializedValuesWrapper {
    fn serialize(
        &self,
        ctx: &RowSerializationContext<'_>,
        writer: &mut RowWriter,
    ) -> Result<(), SerializationError> {
        let actual = usize::from(self.inner.element_count());
        let expected = ctx.columns().len();
        if actual != expected {
            return Err(SerializationError::new(BuiltinTypeCheckError {
                rust_name: std::any::type_name::<Self>(),
                kind: BuiltinTypeCheckErrorKind::WrongColumnCount {
                    rust_cols: actual,
                    cql_cols: expected,
                },
            }));
        }
        for (value, column) in self.inner.iter().zip(ctx.columns()) {
            let cell = writer.make_cell_writer();
            match value {
                RawValue::Value(bytes) => {
                    cell.set_value(bytes).map_err(|_| {
                        mk_ser_err::<Self>(
                            column.typ(),
                            BuiltinSerializationErrorKind::SizeOverflow,
                        )
                    })?;
                }
                RawValue::Null => {
                    cell.set_null();
                }
                RawValue::Unset => {
                    cell.set_unset();
                }
            }
        }
        Ok(())
    }

    fn is_empty(&self) -> bool {
        self.inner.element_count() == 0
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
