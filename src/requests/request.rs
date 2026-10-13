use napi::bindgen_prelude::BigInt;
use scylla::statement::prepared::PreparedStatement;

use std::sync::Arc;

use crate::{result::ResultMetadataTracker, types::type_wrappers::ComplexType};

pub struct PreparedStatementWrapper {
    pub(crate) prepared: PreparedStatement,
    /// Tracks the result metadata generations of this handle.
    /// Shared with the executors of later pages.
    /// Goal: let JS reuse converted result metadata, to avoid N-API conversion cost.
    /// See [`ResultMetadataTracker`].
    pub(crate) result_metadata: Arc<ResultMetadataTracker>,
}

// Missing fields
// customPayload?, any;
// executionProfile?, string | ExecutionProfile;
// hints?, string[] | string[][];
// host?, Host;
// pageState?, Buffer | string;
// retry?, policies.retry.RetryPolicy;
// routingKey?, Buffer | Buffer[];
#[derive(Debug, Default)]
pub struct QueryOptionsObj {
    pub consistency: Option<u16>,
    pub fetch_size: Option<i32>,
    pub is_idempotent: Option<bool>,
    pub request_timeout: Option<i32>,
    pub serial_consistency: Option<i16>,
    pub timestamp: Option<BigInt>,
    pub trace_query: Option<bool>,
}

#[napi]
pub struct QueryOptionsWrapper {
    pub(crate) options: QueryOptionsObj,
}

#[napi]
impl QueryOptionsWrapper {
    /// The options are passed as positional arguments, not as one object.
    /// napi reads positional arguments by index.
    ///
    /// A former approach with Objects involved reading named properties of
    /// an object, which costs a key string and a property lookup for each field.
    ///
    /// The new approach is much more performant on flamegraphs.
    #[napi(constructor)]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
    ) -> Self {
        QueryOptionsWrapper {
            options: QueryOptionsObj {
                consistency,
                fetch_size,
                is_idempotent,
                request_timeout,
                serial_consistency,
                timestamp,
                trace_query,
            },
        }
    }
}

impl PreparedStatementWrapper {
    /// Get array of (expected type, variable name) pairs for this prepared statement.
    pub fn get_expected_types(&self) -> Vec<(ComplexType<'static>, String)> {
        self.prepared
            .get_variable_col_specs()
            .iter()
            .map(|e| {
                (
                    ComplexType::new_owned(e.typ().clone()),
                    e.name().to_string(),
                )
            })
            .collect()
    }
}
