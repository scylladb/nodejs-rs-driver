use napi::bindgen_prelude::BigInt;
use scylla::statement::prepared::PreparedStatement;

use crate::types::type_wrappers::ComplexType;

pub struct PreparedStatementWrapper {
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
#[derive(Debug, Default)]
pub struct QueryOptionsObj {
    pub auto_page: Option<bool>,
    pub capture_stack_trace: Option<bool>,
    pub consistency: Option<u16>,
    pub counter: Option<bool>,
    pub fetch_size: Option<i32>,
    pub is_idempotent: Option<bool>,
    pub keyspace: Option<String>,
    pub logged: Option<bool>,
    pub prepare: Option<bool>,
    pub request_timeout: Option<i32>,
    pub routing_indexes: Option<Vec<i32>>,
    pub routing_names: Option<Vec<String>>,
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
        auto_page: Option<bool>,
        capture_stack_trace: Option<bool>,
        consistency: Option<u16>,
        counter: Option<bool>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        keyspace: Option<String>,
        logged: Option<bool>,
        prepare: Option<bool>,
        request_timeout: Option<i32>,
        routing_indexes: Option<Vec<i32>>,
        routing_names: Option<Vec<String>>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
    ) -> Self {
        QueryOptionsWrapper {
            options: QueryOptionsObj {
                auto_page,
                capture_stack_trace,
                consistency,
                counter,
                fetch_size,
                is_idempotent,
                keyspace,
                logged,
                prepare,
                request_timeout,
                routing_indexes,
                routing_names,
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
