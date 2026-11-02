use napi::bindgen_prelude::BigInt;
use scylla::statement::batch::BatchType;
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

impl QueryOptionsObj {
    /// JS passes the options as positional arguments of each execution call,
    /// not as one object. napi reads positional arguments by index.
    ///
    /// A former approach with Objects involved reading named properties of
    /// an object, which costs a key string and a property lookup for each field.
    /// A later approach wrapped the options in a `#[napi]` class.
    /// Each instance of the class cost a new JS object, `napi_wrap`, and a GC finalizer.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
    ) -> Self {
        QueryOptionsObj {
            consistency,
            fetch_size,
            is_idempotent,
            request_timeout,
            serial_consistency,
            timestamp,
            trace_query,
        }
    }
}

/// The type of a batch, from the `counter` and `logged` options of `Client#batch()`.
///
/// JS gets it as a `const enum`. Thus, JS passes it as a number,
/// and napi reads it with one `napi_get_value_int32` call.
#[napi]
pub enum BatchKind {
    Logged,
    Unlogged,
    Counter,
}

impl From<BatchKind> for BatchType {
    fn from(kind: BatchKind) -> Self {
        match kind {
            BatchKind::Logged => BatchType::Logged,
            BatchKind::Unlogged => BatchType::Unlogged,
            BatchKind::Counter => BatchType::Counter,
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
