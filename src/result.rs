use crate::{
    errors::{ConvertedError, ConvertedResult},
    session::QueryExecutor,
    types::type_wrappers::ComplexType,
    utils::to_napi_obj::CopyableBuffer,
};
use bytes::Bytes;
use napi::{
    bindgen_prelude::{Buffer, ToNapiValue, check_status},
    sys,
};
use scylla::{
    errors::IntoRowsResultError,
    frame::response::result::ColumnSpec,
    response::{
        PagingState,
        query_result::{QueryResult, QueryRowsResult},
    },
};
#[cfg(feature = "tests")]
use std::sync::atomic::{AtomicU32, Ordering};
use std::{ffi::c_void, ptr, sync::Mutex};

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
    /// The result metadata generation of the prepared handle that produced this result.
    /// None for non-row results, and for results of unprepared statements and of batches.
    /// Goal: let JS reuse converted result metadata, to avoid N-API conversion cost.
    /// See [`ResultMetadataTracker`].
    metadata_generation: Option<u32>,
    /// What is needed to fetch the next page. None when this is the last page,
    /// and for unpaged results.
    next_page: Option<NextPage>,
}

/// The paging state of the next page, and the executor that fetches it.
///
/// The result keeps them, so a paged request returns one JS object.
/// JS asks for them only when more pages follow, which most results do not.
pub(crate) struct NextPage {
    pub(crate) paging_state: PagingState,
    pub(crate) executor: QueryExecutor,
}

/// Tracks the result metadata of one prepared statement handle.
///
/// Goal: cache the converted result metadata (column names and types) on the JS side.
/// Converting it from Rust to JS takes many N-API calls per column. Without the cache,
/// this conversion runs for each result. With it, it runs only when the result metadata
/// of the prepared statement changes.
///
/// Each result gets a generation number. Two results have the same generation
/// only if they have the same result metadata. JS uses this to reuse
/// the converted column names and types, without asking for them again.
///
/// Change detection:
/// - If the server sends a result metadata ID (Scylla extension), store and compare only the ID.
/// - Else, store and compare the column specifications. Without the extension,
///   the server sends full metadata with each response.
/// - An empty ID cannot identify the metadata, so it counts as no ID.
/// - If the results switch between having an ID and not having one, count this as a change.
///   This costs one conversion in JS. It can happen, for example, in a mixed cluster
///   during a rolling upgrade, where only some connections use the extension.
#[derive(Default)]
pub(crate) struct ResultMetadataTracker {
    last: Mutex<Option<KnownResultMetadata>>,
}

struct KnownResultMetadata {
    metadata: KnownMetadata,
    generation: u32,
}

/// The part of the result metadata that is needed to detect a change.
enum KnownMetadata {
    /// The result metadata ID. It changes when the metadata changes.
    Id(Vec<u8>),
    /// The column specifications, for results without a result metadata ID.
    ColSpecs(Vec<ColumnSpec<'static>>),
}

impl ResultMetadataTracker {
    fn generation(&self, id: Option<&[u8]>, col_specs: &[ColumnSpec<'_>]) -> u32 {
        let id = id.filter(|id| !id.is_empty());
        let mut last = self
            .last
            .lock()
            .expect("poisoning impossible due to process-aborting panics");
        if let Some(known) = last.as_ref() {
            let same = match (&known.metadata, id) {
                (KnownMetadata::Id(known_id), Some(id)) => known_id.as_slice() == id,
                (KnownMetadata::ColSpecs(known_specs), None) => known_specs.as_slice() == col_specs,
                _ => false,
            };
            if same {
                return known.generation;
            }
        }
        let generation = last.as_ref().map_or(0, |k| k.generation.wrapping_add(1));
        let metadata = match id {
            Some(id) => KnownMetadata::Id(id.to_vec()),
            None => {
                KnownMetadata::ColSpecs(col_specs.iter().map(|s| s.clone().into_owned()).collect())
            }
        };
        *last = Some(KnownResultMetadata {
            metadata,
            generation,
        });
        generation
    }
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
    /// Converts rust query result into query result wrapper that can be passed to NAPI-RS.
    /// For results of unprepared statements and of batches, which have no metadata generation.
    pub(crate) fn from_unprepared_or_batch(
        result: QueryResult,
        next_page: Option<NextPage>,
    ) -> ConvertedResult<QueryResultWrapper> {
        Self::new(result, None, next_page)
    }

    /// Converts rust query result of a prepared handle into query result wrapper,
    /// tagged with its metadata generation in the tracker of the handle.
    /// Goal: let JS reuse converted result metadata, to avoid N-API conversion cost.
    /// See [`ResultMetadataTracker`].
    pub(crate) fn from_prepared(
        result: QueryResult,
        tracker: &ResultMetadataTracker,
        next_page: Option<NextPage>,
    ) -> ConvertedResult<QueryResultWrapper> {
        Self::new(result, Some(tracker), next_page)
    }

    fn new(
        result: QueryResult,
        tracker: Option<&ResultMetadataTracker>,
        next_page: Option<NextPage>,
    ) -> ConvertedResult<QueryResultWrapper> {
        let (inner, metadata_generation) = match result.into_rows_result() {
            Ok(v) => {
                let metadata_generation = tracker.map(|tracker| {
                    let metadata = v.raw_rows_with_metadata().metadata();
                    tracker.generation(metadata.id(), metadata.col_specs())
                });
                (QueryResultVariant::RowsResult(v), metadata_generation)
            }
            Err(IntoRowsResultError::ResultNotRows(v)) => {
                (QueryResultVariant::EmptyResult(v), None)
            }
            Err(IntoRowsResultError::ResultMetadataLazyDeserializationError(e)) => {
                return Err(ConvertedError::from(e));
            }
        };
        Ok(QueryResultWrapper {
            inner,
            metadata_generation,
            next_page,
        })
    }

    /// Returns the raw paging state of the next page, or None when this is the last page.
    #[napi(ts_return_type = "Buffer | null")]
    pub fn get_paging_state(&self) -> Option<CopyableBuffer<'_>> {
        self.next_page.as_ref().map(|next| {
            CopyableBuffer::new(
                next.paging_state
                    .as_bytes_slice()
                    .map_or(&[], |bytes| &bytes[..]),
            )
        })
    }

    /// Returns the executor that fetches the next pages, or None when this is the last page.
    #[napi]
    pub fn get_executor(&self) -> Option<QueryExecutor> {
        self.next_page.as_ref().map(|next| next.executor.clone())
    }

    /// Returns the result metadata generation of the prepared handle that produced this result.
    /// Results with the same generation have the same column names and types.
    /// Returns None for non-row results, and for results of unprepared statements and of batches.
    /// Goal: let JS reuse converted result metadata, to avoid N-API conversion cost.
    /// See ResultMetadataTracker in the Rust code.
    #[napi]
    pub fn get_metadata_generation(&self) -> Option<u32> {
        self.metadata_generation
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

#[cfg(test)]
mod tests {
    use scylla::{
        cluster::metadata::{ColumnType, NativeType},
        frame::response::result::{ColumnSpec, TableSpec},
    };

    use super::ResultMetadataTracker;

    fn spec(name: &str, typ: NativeType) -> ColumnSpec<'static> {
        ColumnSpec::owned(
            name.to_owned(),
            ColumnType::Native(typ),
            TableSpec::owned("ks".to_owned(), "t".to_owned()),
        )
    }

    #[test]
    fn same_metadata_id_keeps_generation() {
        let tracker = ResultMetadataTracker::default();
        let specs = [spec("v", NativeType::Int)];
        assert_eq!(tracker.generation(Some(&[1]), &specs), 0);
        assert_eq!(tracker.generation(Some(&[1]), &specs), 0);
    }

    #[test]
    fn changed_metadata_id_bumps_generation() {
        let tracker = ResultMetadataTracker::default();
        let int = [spec("v", NativeType::Int)];
        let text = [spec("v", NativeType::Text)];
        assert_eq!(tracker.generation(Some(&[1]), &int), 0);
        assert_eq!(tracker.generation(Some(&[2]), &text), 1);
        assert_eq!(tracker.generation(Some(&[2]), &text), 1);
        // Concurrent results across a schema change only cost a refresh.
        assert_eq!(tracker.generation(Some(&[1]), &int), 2);
    }

    #[test]
    fn without_metadata_id_compares_column_specs() {
        let tracker = ResultMetadataTracker::default();
        let int = [spec("v", NativeType::Int)];
        let text = [spec("v", NativeType::Text)];
        let added = [spec("v", NativeType::Int), spec("w", NativeType::Int)];
        assert_eq!(tracker.generation(None, &int), 0);
        assert_eq!(tracker.generation(None, &int), 0);
        // An empty ID cannot identify the metadata, so it counts as no ID.
        assert_eq!(tracker.generation(Some(&[]), &int), 0);
        assert_eq!(tracker.generation(None, &text), 1);
        assert_eq!(tracker.generation(None, &added), 2);
    }

    #[test]
    fn switching_between_id_and_no_id_bumps_generation() {
        let tracker = ResultMetadataTracker::default();
        let int = [spec("v", NativeType::Int)];
        assert_eq!(tracker.generation(Some(&[1]), &int), 0);
        // Same column specs, but the stored ID cannot be compared with them.
        assert_eq!(tracker.generation(None, &int), 1);
        assert_eq!(tracker.generation(None, &int), 1);
        assert_eq!(tracker.generation(Some(&[1]), &int), 2);
    }
}
