use crate::{
    errors::{ConvertedError, ConvertedResult},
    types::type_wrappers::ComplexType,
};
use napi::bindgen_prelude::Buffer;
use scylla::{
    errors::IntoRowsResultError,
    frame::response::result::ColumnSpec,
    response::query_result::{QueryResult, QueryRowsResult},
};

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

    /// Extracts all the rows of the result. This returns the whole result page as a single buffer and a row count.
    #[napi]
    pub fn get_rows(&self) -> Option<(Buffer, u32)> {
        let result = match &self.inner {
            QueryResultVariant::RowsResult(v) => v,
            QueryResultVariant::EmptyResult(_) => {
                return None;
            }
        };

        let res_with_metadata = result.raw_rows_with_metadata();

        Some((
            Buffer::from(res_with_metadata.raw_rows().to_vec()),
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
