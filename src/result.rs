use crate::{
    errors::{ConvertedError, ConvertedResult},
    types::type_wrappers::ComplexType,
};
use bytes::Bytes;
use napi::{
    bindgen_prelude::{Buffer, ToNapiValue, check_status},
    sys,
};
use scylla::{
    errors::IntoRowsResultError,
    frame::response::result::ColumnSpec,
    response::query_result::{QueryResult, QueryRowsResult},
};
#[cfg(feature = "tests")]
use std::sync::atomic::{AtomicU32, Ordering};
use std::{ffi::c_void, ptr};

#[cfg(feature = "tests")]
static PAGE_BUFFER_FINALIZATIONS: AtomicU32 = AtomicU32::new(0);

#[cfg(feature = "tests")]
pub(crate) fn page_buffer_finalizations() -> u32 {
    PAGE_BUFFER_FINALIZATIONS.load(Ordering::Relaxed)
}

enum QueryResultVariant {
    EmptyResult(QueryResult),
    RowsResult(QueryRowsResult),
}

/// Wrapper for a whole query result
#[napi]
pub struct QueryResultWrapper {
    inner: QueryResultVariant,
}

/// Wrapper for the information required in the ResultSet.columns field
#[napi]
pub struct MetaColumnWrapper {
    pub ksname: String,
    pub tablename: String,
    pub name: String,
}

/// Shares the driver's page bytes with a Node.js Buffer until JavaScript releases it.
/// JavaScript can write to this memory, so callers must treat the buffer as read-only.
/// A buffer may keep the whole response frame allocated even when it contains only a slice.
/// Empty pages and runtimes that reject external buffers use Node-owned memory instead.
pub struct PageBuffer(Bytes);

#[cfg(feature = "tests")]
impl PageBuffer {
    pub(crate) fn from_bytes(bytes: Bytes) -> Self {
        Self(bytes)
    }
}

unsafe extern "C" fn finalize_page_buffer(
    _env: sys::napi_env,
    _data: *mut c_void,
    hint: *mut c_void,
) {
    // SAFETY: The hint is the Box transferred after successful buffer creation.
    drop(unsafe { Box::from_raw(hint.cast::<Bytes>()) });
    #[cfg(feature = "tests")]
    PAGE_BUFFER_FINALIZATIONS.fetch_add(1, Ordering::Relaxed);
}

impl ToNapiValue for PageBuffer {
    /// # Safety
    ///
    /// `env` must be a valid N-API environment. The finalizer owns the boxed
    /// `Bytes` only when `napi_create_external_buffer` succeeds.
    unsafe fn to_napi_value(env: sys::napi_env, page: Self) -> napi::Result<sys::napi_value> {
        let mut value = ptr::null_mut();
        let bytes = page.0;
        if bytes.is_empty() {
            check_status!(
                unsafe { sys::napi_create_buffer(env, 0, ptr::null_mut(), &mut value) },
                "Failed to create empty page buffer"
            )?;
            return Ok(value);
        }

        let data = bytes.as_ptr().cast_mut().cast();
        let len = bytes.len();
        let hint = Box::into_raw(Box::new(bytes));
        let status = unsafe {
            sys::napi_create_external_buffer(
                env,
                len,
                data,
                Some(finalize_page_buffer),
                hint.cast(),
                &mut value,
            )
        };
        if status == sys::Status::napi_no_external_buffers_allowed {
            // The runtime cannot hold Rust-owned memory; make the required copy instead.
            let bytes = unsafe { Box::from_raw(hint) };
            check_status!(
                unsafe {
                    sys::napi_create_buffer_copy(
                        env,
                        len,
                        bytes.as_ptr().cast(),
                        ptr::null_mut(),
                        &mut value,
                    )
                },
                "Failed to copy page buffer"
            )?;
        } else if status != sys::Status::napi_ok {
            drop(unsafe { Box::from_raw(hint) });
            check_status!(status, "Failed to create external page buffer")?;
        }
        Ok(value)
    }
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

    /// Extracts all the rows of the result as an independent buffer and a row count.
    #[napi]
    pub fn get_rows(&self) -> Option<(Buffer, u32)> {
        self.rows_bytes_and_count()
            .map(|(bytes, count)| (Buffer::from(bytes.to_vec()), count))
    }

    /// Used by the TypeScript decoder when it copies buffer-valued cells.
    /// JavaScript must not mutate the returned page while Rust retains it.
    #[napi(ts_return_type = "[Buffer, number] | null")]
    pub fn get_rows_shared(&self) -> Option<(PageBuffer, u32)> {
        self.rows_bytes_and_count()
            .map(|(bytes, count)| (PageBuffer(bytes.clone()), count))
    }

    fn rows_bytes_and_count(&self) -> Option<(&Bytes, u32)> {
        let result = match &self.inner {
            QueryResultVariant::RowsResult(v) => v,
            QueryResultVariant::EmptyResult(_) => {
                return None;
            }
        };

        let res_with_metadata = result.raw_rows_with_metadata();

        Some((
            res_with_metadata.raw_rows(),
            // According to CQLv4 spec, row count is a 4 bytes integer:
            // > <rows_count> is an [int] representing the number of rows present in this result
            // This means we can safely convert it to u32, as the Rust driver should handle checking the correctness of the received data.
            res_with_metadata
                .rows_count()
                .try_into()
                .expect("Expected row count to fit into u32. This is a bug in the driver."),
        ))
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
