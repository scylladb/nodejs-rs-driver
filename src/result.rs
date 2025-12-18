use crate::{
    errors::{
        ConvertedError, ConvertedResult, IntoConvertedResult, JsResult, with_custom_error_sync,
    },
    types::{local_date::LocalDateWrapper, type_wrappers::ComplexType},
};
use napi::{
    Env, JsValue,
    bindgen_prelude::{BigInt, Buffer, JsObjectValue, Object, ToNapiValue},
};
use scylla::{
    errors::IntoRowsResultError,
    frame::response::result::ColumnSpec,
    response::query_result::{QueryResult, QueryRowsResult},
    value::{CqlValue, Row},
};

use crate::types::duration::DurationWrapper;
use crate::types::inet::InetAddressWrapper;
use crate::types::local_time::LocalTimeWrapper;

enum QueryResultVariant {
    EmptyResult(QueryResult),
    RowsResult(QueryRowsResult),
}

/// Wrapper for a whole query result
#[napi]
pub struct QueryResultWrapper {
    inner: QueryResultVariant,
}

/// Wrapper for a single row of the query result
///
/// Whenever it's returned from NAPI function call
/// it's automatically converted to the inner vector
pub struct RowWrapper {
    inner: Vec<Option<CqlValue>>,
}

/// Wrapper for a single CQL value
///
/// When returned from NAPI-RS, returns either just a inner value or tuple of elements: ``(cqlType, value)``
///
/// Plain value is returned, when we know how to treat the value, based on the value type.
/// The tuple is returned when there is ambiguity how the given value
/// should be handled, based on its type.
///
/// For example if we return String, no matter if it's CqlAscii or CqlText,
/// we treat it the same, and don't need to specify CqlType.
/// On the other hand, CqlBigInt and CqlTimestamp are returned from rust layer
/// as BigInt, but are provided to driver's user as BigInt and Date, respectively.
pub struct CqlValueWrapper {
    pub(crate) inner: CqlValue,
}

/// Wrapper for the information required in the ResultSet.columns field
#[napi]
pub struct MetaColumnWrapper {
    pub ksname: String,
    pub tablename: String,
    pub name: String,
}

#[napi]
impl QueryResultWrapper {
    /// Converts rust query result into query result wrapper that can be passed to NAPI-RS
    pub fn from_query(result: QueryResult) -> ConvertedResult<QueryResultWrapper> {
        let value = match result.into_rows_result() {
            Ok(v) => QueryResultVariant::RowsResult(v),
            Err(IntoRowsResultError::ResultNotRows(v)) => QueryResultVariant::EmptyResult(v),
            Err(IntoRowsResultError::ResultMetadataLazyDeserializationError(e)) => {
                return Err(ConvertedError::from(e));
            }
        };
        Ok(QueryResultWrapper { inner: value })
    }

    /// Extracts all the rows of the result into a vector of rows
    #[napi]
    pub fn get_rows(&self) -> JsResult<Option<Vec<RowWrapper>>> {
        with_custom_error_sync(|| {
            let result = match &self.inner {
                QueryResultVariant::RowsResult(v) => v,
                QueryResultVariant::EmptyResult(_) => {
                    return ConvertedResult::Ok(None);
                }
            };

            let rows = result.rows::<Row>()
            .expect("Type check against the Row type has failed; this is a bug in the underlying Rust driver");

            Ok(Some(
                rows.map(|f| {
                    f.map(|v| RowWrapper { inner: v.columns })
                        .into_converted_result()
                })
                .collect::<ConvertedResult<Vec<_>>>()?,
            ))
        })
    }

    /// Get the names of the columns in order, as they appear in the query result
    #[napi]
    pub fn get_columns_names(&self) -> Vec<String> {
        match &self.inner {
            QueryResultVariant::RowsResult(v) => v,
            QueryResultVariant::EmptyResult(_) => {
                return vec![];
            }
        }
        .column_specs()
        .iter()
        .map(|f| f.name().to_owned())
        .collect()
    }

    /// Get the names of the columns in order, as they appear in the query result
    #[napi]
    pub fn get_columns_types(&self) -> Vec<ComplexType<'_>> {
        match &self.inner {
            QueryResultVariant::RowsResult(v) => v,
            QueryResultVariant::EmptyResult(_) => {
                return vec![];
            }
        }
        .column_specs()
        .iter()
        .map(|f: &ColumnSpec| ComplexType::new_borrowed(f.typ()))
        .collect()
    }

    /// Get the coordinator that answered the query
    #[napi]
    pub fn get_coordinator(&self) -> String {
        let coordinator = match &self.inner {
            QueryResultVariant::EmptyResult(query_result) => query_result.request_coordinator(),
            QueryResultVariant::RowsResult(query_rows_result) => {
                query_rows_result.request_coordinator()
            }
        };
        coordinator.connection_address().to_string()
    }

    /// Get the specification of all columns as they appear in the query result
    #[napi]
    pub fn get_columns_specs(&self) -> Vec<MetaColumnWrapper> {
        match &self.inner {
            QueryResultVariant::RowsResult(v) => v,
            QueryResultVariant::EmptyResult(_) => {
                return vec![];
            }
        }
        .column_specs()
        .iter()
        .map(|f| MetaColumnWrapper {
            ksname: f.table_spec().ks_name().to_owned(),
            tablename: f.table_spec().table_name().to_owned(),
            name: f.name().to_owned(),
        })
        .collect()
    }

    /// Get all warnings generated in the query
    #[napi]
    pub fn get_warnings(&self) -> Vec<String> {
        match &self.inner {
            QueryResultVariant::RowsResult(v) => v.warnings().map(|e| e.to_owned()).collect(),
            QueryResultVariant::EmptyResult(v) => v.warnings().map(|e| e.to_owned()).collect(),
        }
    }

    /// Get all tracing ids generated in the query
    #[napi]
    pub fn get_trace_id(&self) -> Option<Buffer> {
        match &self.inner {
            QueryResultVariant::RowsResult(v) => v
                .tracing_id()
                .map(|val| Buffer::from(val.as_bytes().as_slice())),
            QueryResultVariant::EmptyResult(v) => v
                .tracing_id()
                .map(|val| Buffer::from(val.as_bytes().as_slice())),
        }
    }
}

impl ToNapiValue for RowWrapper {
    /// # Safety
    ///
    /// Valid pointer to napi env must be provided
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        val: Self,
    ) -> napi::Result<napi::sys::napi_value> {
        // Caller of this function ensures a valid pointer to napi env is provided
        unsafe {
            Vec::to_napi_value(
                env,
                val.inner
                    .into_iter()
                    .map(|e| e.map(|f| CqlValueWrapper { inner: f }))
                    .collect(),
            )
        }
    }
}

impl From<Row> for RowWrapper {
    fn from(value: Row) -> Self {
        RowWrapper {
            inner: value.columns,
        }
    }
}

impl ToNapiValue for CqlValueWrapper {
    /// # Safety
    ///
    /// Valid pointer to napi env must be provided
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        value: Self,
    ) -> napi::Result<napi::sys::napi_value> {
        // Caller of this function ensures a valid pointer to napi env is provided
        unsafe {
            match value.inner {
                CqlValue::Ascii(val) => String::to_napi_value(env, val),
                CqlValue::Boolean(val) => bool::to_napi_value(env, val),
                CqlValue::Blob(val) => Buffer::to_napi_value(env, val.into()),
                CqlValue::Counter(val) => BigInt::to_napi_value(env, val.0.into()),
                CqlValue::Decimal(val) => {
                    const EXP_SIZE: usize = 4;
                    // JS driver expects decimal to be in the format of Decimal from CQL protocol.
                    // Returned buffer is in format XXXXYYYY...YYY
                    // where XXXX (4 bytes) is the exponent of the decimal in big endian
                    // and YYYY...YYY is the value of the decimal in big endian.
                    let (value, len) = val.as_signed_be_bytes_slice_and_exponent();
                    let mut buf = vec![0u8; EXP_SIZE + value.len()];
                    buf[0..EXP_SIZE].copy_from_slice(&len.to_be_bytes());
                    buf[EXP_SIZE..].copy_from_slice(value);
                    Buffer::to_napi_value(env, Buffer::from(buf))
                }
                CqlValue::Date(val) => {
                    LocalDateWrapper::to_napi_value(env, LocalDateWrapper::from_cql_date(val))
                }
                CqlValue::Double(val) => f64::to_napi_value(env, val),
                CqlValue::Duration(val) => {
                    DurationWrapper::to_napi_value(env, DurationWrapper::from_cql_duration(val))
                }
                CqlValue::Empty => todo!(),
                CqlValue::Float(val) => f32::to_napi_value(env, val),
                CqlValue::Int(val) => i32::to_napi_value(env, val),
                CqlValue::BigInt(val) => BigInt::to_napi_value(env, val.into()),
                CqlValue::Text(val) => String::to_napi_value(env, val),
                CqlValue::Timestamp(val) => BigInt::to_napi_value(env, val.0.into()),
                CqlValue::Inet(val) => {
                    InetAddressWrapper::to_napi_value(env, InetAddressWrapper::from_ip_addr(val))
                }
                CqlValue::List(val) => Vec::to_napi_value(
                    env,
                    val.into_iter()
                        .map(|e| CqlValueWrapper::to_napi_value(env, CqlValueWrapper { inner: e }))
                        .collect(),
                ),
                CqlValue::Map(val) => Vec::to_napi_value(
                    env,
                    val.into_iter()
                        .map(|e: (CqlValue, CqlValue)| {
                            vec![
                                CqlValueWrapper { inner: e.0 },
                                CqlValueWrapper { inner: e.1 },
                            ]
                        })
                        .collect(),
                ),
                CqlValue::Set(val) => Vec::to_napi_value(
                    env,
                    val.into_iter()
                        .map(|e| CqlValueWrapper::to_napi_value(env, CqlValueWrapper { inner: e }))
                        .collect(),
                ),
                CqlValue::UserDefinedType {
                    keyspace: _,
                    name: _,
                    fields,
                } => {
                    // Create an empty JS object
                    let env_obj = Env::from_raw(env);
                    let mut obj = Object::new(&env_obj)?;

                    // And fill it with the wrapped values
                    fields
                        .into_iter()
                        .try_for_each(|(field_name, field_value)| {
                            obj.set_named_property(
                                &field_name,
                                field_value.map(|e| {
                                    CqlValueWrapper::to_napi_value(
                                        // Value wrapping
                                        env,
                                        CqlValueWrapper { inner: e },
                                    )
                                }),
                            )
                        })
                        .map(|_| obj.raw())
                }

                CqlValue::SmallInt(val) => i16::to_napi_value(env, val),
                CqlValue::TinyInt(val) => i8::to_napi_value(env, val),
                CqlValue::Time(val) => {
                    LocalTimeWrapper::to_napi_value(env, LocalTimeWrapper::from_cql_time(val))
                }
                CqlValue::Timeuuid(val) => {
                    Buffer::to_napi_value(env, Buffer::from(val.as_bytes().as_slice()))
                }

                CqlValue::Tuple(val) => Vec::to_napi_value(
                    env,
                    val.into_iter()
                        .map(|v| {
                            v.map(|e| {
                                CqlValueWrapper::to_napi_value(
                                    env,
                                    CqlValueWrapper { inner: e.clone() },
                                )
                            })
                        })
                        .collect(),
                ),

                CqlValue::Uuid(val) => {
                    Buffer::to_napi_value(env, Buffer::from(val.as_bytes().as_slice()))
                }

                CqlValue::Varint(val) => {
                    let (sign, words) =
                        num_bigint::BigInt::from_signed_bytes_be(val.as_signed_bytes_be_slice())
                            .to_u64_digits();

                    BigInt::to_napi_value(
                        env,
                        BigInt {
                            sign_bit: sign == num_bigint::Sign::Minus,
                            words,
                        },
                    )
                }
                CqlValue::Vector(val) => Vec::to_napi_value(
                    env,
                    val.into_iter()
                        .map(|v| CqlValueWrapper::to_napi_value(env, CqlValueWrapper { inner: v }))
                        .collect(),
                ),
                other => unimplemented!("Missing implementation for CQL value {:?}", other),
            }
        }
    }
}
