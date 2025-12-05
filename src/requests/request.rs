use napi::bindgen_prelude::BigInt;
use scylla::statement::prepared::PreparedStatement;

use crate::{
    types::type_wrappers::ComplexType, utils::from_napi_obj::define_js_to_rust_convertible_object,
};

pub(crate) struct PreparedStatementWrapper {
    pub(crate) prepared: PreparedStatement,
}

// Missing fields
// customPayload?, any;
// executionProfile?, string | ExecutionProfile;
// hints?, string[] | string[][];
// host?, Host;
// pageState?, Buffer | string;
// retry?, policies.retry.RetryPolicy;
// routingKey?, Buffer | Buffer[];
define_js_to_rust_convertible_object!(
    QueryOptionsObj{
        auto_page, autoPage: bool,
        capture_stack_trace, captureStackTrace: bool,
        consistency, consistency: u16,
        counter, counter: bool,
        fetch_size, fetchSize: i32,
        is_idempotent, isIdempotent: bool,
        keyspace, keyspace: String,
        logged, logged: bool,
        prepare, prepare: bool,
        read_timeout, readTimeout: i32,
        routing_indexes, routingIndexes: Vec<i32>,
        routing_names, routingNames: Vec<String>,
        serial_consistency, serialConsistency: i16,
        timestamp, timestamp: BigInt,
        trace_query, traceQuery: bool,
    }
);

#[napi]
pub struct QueryOptionsWrapper {
    pub(crate) options: QueryOptionsObj,
}

#[napi]
impl QueryOptionsWrapper {
    #[napi(constructor)]
    pub fn new(options: QueryOptionsObj) -> Self {
        QueryOptionsWrapper { options }
    }
}

impl PreparedStatementWrapper {
    /// Get array of expected types for this prepared statement.
    pub fn get_expected_types(&self) -> Vec<ComplexType<'static>> {
        self.prepared
            .get_variable_col_specs()
            .iter()
            .map(|e| ComplexType::new_owned(e.typ().clone()))
            .collect()
    }
}
