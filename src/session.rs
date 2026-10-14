pub mod config;
use std::collections::BTreeSet;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use config::SessionOptions;
use napi::bindgen_prelude::{BigInt, Buffer, External, ExternalRef, ToNapiValue};
use napi::{Env, sys};
use scylla::client::session::Session;
use scylla::errors::{ExecutionError, RequestAttemptError};
use scylla::response::{PagingState, PagingStateResponse};
use scylla::serialize::row::{BuiltinTypeCheckError, BuiltinTypeCheckErrorKind};
use scylla::statement::batch::{Batch, BatchStatement};
use scylla::statement::prepared::PreparedStatement;
use scylla::statement::{Consistency, SerialConsistency, Statement};

use crate::async_bridge::{BridgedPromise, JsAsyncResult};
use crate::errors::{ConvertedError, ConvertedResult, make_js_error};
use crate::metadata::state::ClusterSnapshot;
use crate::requests::request::PreparedStatementWrapper;
use crate::requests::request::QueryOptionsObj;
use crate::result::{NextPage, QueryResultWrapper, ResultMetadataTracker};
use crate::session::config::configure_session_builder;
use crate::types::encoded_data::{EncodedValuesWrapper, SerializedValuesWrapper};
use crate::types::type_wrappers::ComplexType;
use crate::utils::bigint_to_i64;
use crate::utils::js_thread_only::JsThreadOnly;

/// The session of the driver.
///
/// JS gets it as an `External`, not as an instance of a `#[napi]` class,
/// for the same reason as [`QueryResultWrapper`].
/// A method call on a class instance costs `napi_unwrap` and a borrow check of napi-rs.
/// JS uses the session in each execution, so this cost adds up.
/// JS calls the methods through the `session_*` functions, for example
/// [`session_execute_prepared_single_page`].
pub struct SessionWrapper {
    pub(crate) inner: Arc<Session>,
    /// Cache of the last `ClusterSnapshot` that was computed, alongside the `Arc<ClusterState>`
    /// pointer it was built from.
    cluster_snapshot: Mutex<Option<JsThreadOnly<ClusterSnapshot>>>,
}

/// This object allows executing queries for following pages of the result,
/// without the need to pass the statement and parameters multiple times.
/// This structure is tied to specific session.
///
/// JS gets it as an `External`, not as an instance of a `#[napi]` class,
/// for the same reason as [`QueryResultWrapper`].
/// JS fetches the next page with [`executor_fetch_next_page`].
#[derive(Clone)]
pub struct QueryExecutor {
    values: Arc<QueryValues>,
}

enum QueryValues {
    Unprepared {
        params: SerializedValuesWrapper,
        statement: Statement,
    },
    Prepared {
        values: SerializedValuesWrapper,
        statement: PreparedStatement,
        /// The tracker of the prepared handle, so that later pages are also tagged
        /// with metadata generations.
        /// Goal: let JS reuse converted result metadata, to avoid N-API conversion cost.
        /// See [`ResultMetadataTracker`].
        result_metadata: Arc<ResultMetadataTracker>,
    },
}

/// A native prepared handle and its bind metadata: (expected type, variable name) pairs.
type PreparedHandleWithBindMetadata = (
    External<PreparedStatementWrapper>,
    Vec<(ComplexType<'static>, String)>,
);

fn validate_value_count(
    prepared: &PreparedStatement,
    params: &SerializedValuesWrapper,
) -> ConvertedResult<()> {
    let expected = prepared.get_variable_col_specs().len();
    let actual = usize::from(params.inner.element_count());
    if actual != expected {
        let error = scylla::errors::SerializationError::new(BuiltinTypeCheckError {
            rust_name: std::any::type_name::<SerializedValuesWrapper>(),
            kind: BuiltinTypeCheckErrorKind::WrongColumnCount {
                rust_cols: actual,
                cql_cols: expected,
            },
        });
        return Err(ConvertedError::from(ExecutionError::from(error)));
    }
    Ok(())
}

impl QueryExecutor {
    fn new(values: QueryValues) -> Self {
        QueryExecutor {
            values: Arc::new(values),
        }
    }
}

impl QueryExecutor {
    /// Fetches one page. The result keeps this executor if more pages follow.
    async fn fetch_next_page_internal(
        session: &Session,
        executor: &QueryExecutor,
        paging_state: Option<PagingState>,
    ) -> ConvertedResult<QueryResultWrapper> {
        let paging_state = paging_state.unwrap_or(PagingState::start());
        let next_page = |paging_state_response| match paging_state_response {
            PagingStateResponse::HasMorePages { state } => Some(NextPage {
                paging_state: state,
                executor: executor.clone(),
            }),
            PagingStateResponse::NoMorePages => None,
        };

        match &*executor.values {
            QueryValues::Prepared {
                values,
                statement,
                result_metadata,
            } => {
                let (result, paging_state_response) = session
                    .execute_unstable(statement, &values.inner, true, paging_state)
                    .await?;
                QueryResultWrapper::from_prepared(
                    result,
                    result_metadata,
                    next_page(paging_state_response),
                )
            }
            QueryValues::Unprepared { params, statement } => {
                let (result, paging_state_response) = session
                    .query_single_page(statement.clone(), params, paging_state)
                    .await?;
                QueryResultWrapper::from_unprepared_or_batch(
                    result,
                    next_page(paging_state_response),
                )
            }
        }
    }
}
impl ToNapiValue for SessionWrapper {
    unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> napi::Result<sys::napi_value> {
        unsafe { External::to_napi_value(env, External::new(val)) }
    }
}

impl ToNapiValue for QueryExecutor {
    unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> napi::Result<sys::napi_value> {
        unsafe { External::to_napi_value(env, External::new(val)) }
    }
}

/// Fetches the page of the given paging state with the given executor.
#[napi(ts_return_type = "Promise<ExternalObject<QueryResultWrapper>>")]
pub fn executor_fetch_next_page(
    env: Env,
    executor: &External<QueryExecutor>,
    session: &External<SessionWrapper>,
    paging_state: Option<Buffer>,
) -> JsAsyncResult<QueryResultWrapper> {
    BridgedPromise::spawn(&env, || {
        let executor = QueryExecutor::clone(executor);
        let session_inner = Arc::clone(&session.inner);
        let paging_state = paging_state.map(|p| PagingState::new_from_raw_bytes(&*p));
        Ok(async move {
            QueryExecutor::fetch_next_page_internal(&session_inner, &executor, paging_state).await
        })
    })
}

impl SessionWrapper {
    async fn execute_unpaged_serialized(
        session: &Session,
        prepared: &PreparedStatement,
        params: &SerializedValuesWrapper,
        result_metadata: &ResultMetadataTracker,
    ) -> ConvertedResult<QueryResultWrapper> {
        validate_value_count(prepared, params)?;
        // The unstable interop API accepts already-owned SerializedValues. This
        // avoids sending JS buffers or per-value Vec copies across an await.
        let (result, paging_state) = session
            .execute_unstable(prepared, &params.inner, false, PagingState::start())
            .await?;
        if !matches!(paging_state, PagingStateResponse::NoMorePages) {
            tracing::error!("Unpaged prepared query returned a non-empty paging state");
            return Err(ConvertedError::from(ExecutionError::LastAttemptError(
                RequestAttemptError::NonfinishedPagingState,
            )));
        }
        QueryResultWrapper::from_prepared(result, result_metadata, None)
    }

    /// Creates session based on the provided session options.
    pub fn create_session(env: Env, options: SessionOptions) -> JsAsyncResult<SessionWrapper> {
        BridgedPromise::spawn(&env, || {
            Ok(async move {
                let local_datacenter = options.local_datacenter.clone();
                let builder = configure_session_builder(options)?;
                let session = builder.build().await?;
                validate_local_datacenter(&session, local_datacenter.as_deref())?;
                Ok(SessionWrapper {
                    inner: Arc::new(session),
                    cluster_snapshot: Mutex::new(None),
                })
            })
        })
    }

    /// Returns the name of the current keyspace
    pub fn get_keyspace(&self) -> Option<String> {
        self.inner.get_keyspace().as_deref().map(ToOwned::to_owned)
    }

    /// Checks whether all nodes that are currently up agree on the schema version.
    ///
    /// This is a one-time check, without any form of retry.
    ///
    /// Failing to perform the check is not reported as an error: the Rust driver's failure is
    /// logged as a warning (and thus reaches the client's log emitter through the logging
    /// bridge) and reported as "no agreement".
    pub fn check_schema_agreement(&self, env: Env) -> JsAsyncResult<bool> {
        BridgedPromise::spawn(&env, || {
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                Ok(match inner.check_schema_agreement().await {
                    Ok(agreed_version) => agreed_version.is_some(),
                    Err(err) => {
                        tracing::warn!(
                            "There was an error while checking the schema agreement: {err}"
                        );
                        false
                    }
                })
            })
        })
    }

    /// Waits until all currently reachable nodes agree on the schema version.
    ///
    /// Unlike `check_schema_agreement`, which performs a single, non-retrying check and never
    /// fails, this retries at the driver's `schema_agreement_interval` until agreement is
    /// reached or `schema_agreement_timeout` elapses, rejecting if agreement could not be
    /// reached in time - or could not be checked at all, for example if no node is reachable.
    pub fn wait_for_schema_agreement(&self, env: Env) -> JsAsyncResult<()> {
        BridgedPromise::spawn(&env, || {
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                inner.await_schema_agreement().await?;
                Ok(())
            })
        })
    }

    /// Executes unprepared statement. This assumes the types will be either guessed or provided by user.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    ///
    /// The values must be encoded by JS into one buffer (see [`SerializedValuesWrapper`]).
    /// If the values do not match the column types, this query will fail.
    #[allow(clippy::too_many_arguments)]
    pub fn query_unpaged(
        &self,
        env: Env,
        query: String,
        params: SerializedValuesWrapper,
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        let options = QueryOptionsObj::new(
            consistency,
            fetch_size,
            is_idempotent,
            request_timeout,
            serial_consistency,
            timestamp,
            trace_query,
        );
        BridgedPromise::spawn(&env, || {
            let statement: Statement = self.apply_statement_options(query.into(), &options)?;
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                let result = inner.query_unpaged(statement, params).await?;
                QueryResultWrapper::from_unprepared_or_batch(result, None)
            })
        })
    }

    /// Prepares a statement through rust driver for a given session.
    /// Returns the native prepared handle and its bind metadata. The bind metadata
    /// remains fixed for this handle even if the schema changes.
    pub fn prepare_statement(
        &self,
        env: Env,
        statement: String,
    ) -> JsAsyncResult<PreparedHandleWithBindMetadata> {
        BridgedPromise::spawn(&env, || {
            let statement: Statement = statement.into();
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                let handle = PreparedStatementWrapper {
                    prepared: inner.prepare(statement).await?,
                    result_metadata: Default::default(),
                };
                let expected_types = handle.get_expected_types();
                ConvertedResult::Ok((External::new(handle), expected_types))
            })
        })
    }

    /// Execute a given prepared statement against the database with provided parameters,
    /// without paging.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    ///
    /// All parameters must be already serialized according to the bind metadata
    /// of the prepared statement.
    #[allow(clippy::too_many_arguments)]
    pub fn execute_prepared_unpaged(
        &self,
        env: Env,
        handle: &External<PreparedStatementWrapper>,
        params: SerializedValuesWrapper,
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        let options = QueryOptionsObj::new(
            consistency,
            fetch_size,
            is_idempotent,
            request_timeout,
            serial_consistency,
            timestamp,
            trace_query,
        );
        BridgedPromise::spawn(&env, || {
            let statement =
                self.apply_prepared_statement_options(handle.prepared.clone(), &options)?;
            let result_metadata = Arc::clone(&handle.result_metadata);
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                Self::execute_unpaged_serialized(&inner, &statement, &params, &result_metadata)
                    .await
            })
        })
    }

    /// Executes a batch of unprepared statements with the provided options.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    #[allow(clippy::too_many_arguments)]
    pub fn batch(
        &self,
        env: Env,
        statements: Vec<String>,
        params: Vec<Vec<EncodedValuesWrapper>>,
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        let options = QueryOptionsObj::new(
            consistency,
            fetch_size,
            is_idempotent,
            request_timeout,
            serial_consistency,
            timestamp,
            trace_query,
        );
        self.execute_batch(
            env,
            params,
            &options,
            statements
                .into_iter()
                .map(Statement::from)
                .map(BatchStatement::Query),
        )
    }

    /// Executes a batch of already prepared statements with the provided options.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    #[allow(clippy::too_many_arguments)]
    pub fn batch_prepared(
        &self,
        env: Env,
        statements: Vec<ExternalRef<PreparedStatementWrapper>>,
        params: Vec<Vec<EncodedValuesWrapper>>,
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        let options = QueryOptionsObj::new(
            consistency,
            fetch_size,
            is_idempotent,
            request_timeout,
            serial_consistency,
            timestamp,
            trace_query,
        );
        self.execute_batch(
            env,
            params,
            &options,
            statements
                .iter()
                .map(|handle| BatchStatement::PreparedStatement(handle.prepared.clone())),
        )
    }

    /// Builds a batch of the given statements, applies the options, and executes it.
    fn execute_batch(
        &self,
        env: Env,
        params: Vec<Vec<EncodedValuesWrapper>>,
        options: &QueryOptionsObj,
        statements: impl Iterator<Item = BatchStatement>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        BridgedPromise::spawn(&env, || {
            let mut batch: Batch = Default::default();
            statements.for_each(|statement| batch.append_statement(statement));
            let batch = self.apply_batch_options(batch, options)?;
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                let res = inner.batch(&batch, params).await?;
                QueryResultWrapper::from_unprepared_or_batch(res, None)
            })
        })
    }

    /// Query a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[allow(clippy::too_many_arguments)]
    pub fn query_single_page(
        &self,
        env: Env,
        query: String,
        params: SerializedValuesWrapper,
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
        paging_state: Option<Buffer>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        let options = QueryOptionsObj::new(
            consistency,
            fetch_size,
            is_idempotent,
            request_timeout,
            serial_consistency,
            timestamp,
            trace_query,
        );
        BridgedPromise::spawn(&env, || {
            let statement = self.apply_statement_options(query.into(), &options)?;
            let executor = QueryExecutor::new(QueryValues::Unprepared { params, statement });
            let paging_state = paging_state.map(|p| PagingState::new_from_raw_bytes(&*p));
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                QueryExecutor::fetch_next_page_internal(&inner, &executor, paging_state).await
            })
        })
    }

    /// Execute a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[allow(clippy::too_many_arguments)]
    pub fn execute_prepared_single_page(
        &self,
        env: Env,
        handle: &External<PreparedStatementWrapper>,
        params: SerializedValuesWrapper,
        consistency: Option<u16>,
        fetch_size: Option<i32>,
        is_idempotent: Option<bool>,
        request_timeout: Option<i32>,
        serial_consistency: Option<i16>,
        timestamp: Option<BigInt>,
        trace_query: Option<bool>,
        paging_state: Option<Buffer>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        let options = QueryOptionsObj::new(
            consistency,
            fetch_size,
            is_idempotent,
            request_timeout,
            serial_consistency,
            timestamp,
            trace_query,
        );
        BridgedPromise::spawn(&env, || {
            let statement =
                self.apply_prepared_statement_options(handle.prepared.clone(), &options)?;
            validate_value_count(&statement, &params)?;
            let paging_state = paging_state.map(|p| PagingState::new_from_raw_bytes(&*p));
            let result_metadata = Arc::clone(&handle.result_metadata);
            let inner = Arc::clone(&self.inner);
            Ok(async move {
                let executor = QueryExecutor::new(QueryValues::Prepared {
                    values: params,
                    statement,
                    result_metadata,
                });

                QueryExecutor::fetch_next_page_internal(&inner, &executor, paging_state).await
            })
        })
    }
}

// JS reads the session with these functions. See [`SessionWrapper`].

/// JS binding of [`SessionWrapper::create_session`].
#[napi(ts_return_type = "Promise<ExternalObject<SessionWrapper>>")]
pub fn create_session(env: Env, options: SessionOptions) -> JsAsyncResult<SessionWrapper> {
    SessionWrapper::create_session(env, options)
}

/// JS binding of [`SessionWrapper::get_keyspace`].
#[napi]
pub fn session_get_keyspace(session: &External<SessionWrapper>) -> Option<String> {
    session.get_keyspace()
}

/// JS binding of [`SessionWrapper::check_schema_agreement`].
#[napi(ts_return_type = "Promise<boolean>")]
pub fn session_check_schema_agreement(
    session: &External<SessionWrapper>,
    env: Env,
) -> JsAsyncResult<bool> {
    session.check_schema_agreement(env)
}

/// JS binding of [`SessionWrapper::wait_for_schema_agreement`].
#[napi(ts_return_type = "Promise<void>")]
pub fn session_wait_for_schema_agreement(
    session: &External<SessionWrapper>,
    env: Env,
) -> JsAsyncResult<()> {
    session.wait_for_schema_agreement(env)
}

/// JS binding of [`SessionWrapper::query_unpaged`].
#[napi(ts_return_type = "Promise<ExternalObject<QueryResultWrapper>>")]
#[allow(clippy::too_many_arguments)]
pub fn session_query_unpaged(
    session: &External<SessionWrapper>,
    env: Env,
    query: String,
    params: SerializedValuesWrapper,
    consistency: Option<u16>,
    fetch_size: Option<i32>,
    is_idempotent: Option<bool>,
    request_timeout: Option<i32>,
    serial_consistency: Option<i16>,
    timestamp: Option<BigInt>,
    trace_query: Option<bool>,
) -> JsAsyncResult<QueryResultWrapper> {
    session.query_unpaged(
        env,
        query,
        params,
        consistency,
        fetch_size,
        is_idempotent,
        request_timeout,
        serial_consistency,
        timestamp,
        trace_query,
    )
}

/// JS binding of [`SessionWrapper::prepare_statement`].
#[napi(
    ts_return_type = "Promise<[ExternalObject<PreparedStatementWrapper>, Array<[ComplexType, string]>]>"
)]
pub fn session_prepare_statement(
    session: &External<SessionWrapper>,
    env: Env,
    statement: String,
) -> JsAsyncResult<PreparedHandleWithBindMetadata> {
    session.prepare_statement(env, statement)
}

/// JS binding of [`SessionWrapper::execute_prepared_unpaged`].
#[napi(ts_return_type = "Promise<ExternalObject<QueryResultWrapper>>")]
#[allow(clippy::too_many_arguments)]
pub fn session_execute_prepared_unpaged(
    session: &External<SessionWrapper>,
    env: Env,
    handle: &External<PreparedStatementWrapper>,
    params: SerializedValuesWrapper,
    consistency: Option<u16>,
    fetch_size: Option<i32>,
    is_idempotent: Option<bool>,
    request_timeout: Option<i32>,
    serial_consistency: Option<i16>,
    timestamp: Option<BigInt>,
    trace_query: Option<bool>,
) -> JsAsyncResult<QueryResultWrapper> {
    session.execute_prepared_unpaged(
        env,
        handle,
        params,
        consistency,
        fetch_size,
        is_idempotent,
        request_timeout,
        serial_consistency,
        timestamp,
        trace_query,
    )
}

/// JS binding of [`SessionWrapper::batch`].
#[napi(ts_return_type = "Promise<ExternalObject<QueryResultWrapper>>")]
#[allow(clippy::too_many_arguments)]
pub fn session_batch(
    session: &External<SessionWrapper>,
    env: Env,
    statements: Vec<String>,
    params: Vec<Vec<EncodedValuesWrapper>>,
    consistency: Option<u16>,
    fetch_size: Option<i32>,
    is_idempotent: Option<bool>,
    request_timeout: Option<i32>,
    serial_consistency: Option<i16>,
    timestamp: Option<BigInt>,
    trace_query: Option<bool>,
) -> JsAsyncResult<QueryResultWrapper> {
    session.batch(
        env,
        statements,
        params,
        consistency,
        fetch_size,
        is_idempotent,
        request_timeout,
        serial_consistency,
        timestamp,
        trace_query,
    )
}

/// JS binding of [`SessionWrapper::batch_prepared`].
#[napi(ts_return_type = "Promise<ExternalObject<QueryResultWrapper>>")]
#[allow(clippy::too_many_arguments)]
pub fn session_batch_prepared(
    session: &External<SessionWrapper>,
    env: Env,
    #[napi(ts_arg_type = "Array<ExternalObject<PreparedStatementWrapper>>")] statements: Vec<
        ExternalRef<PreparedStatementWrapper>,
    >,
    params: Vec<Vec<EncodedValuesWrapper>>,
    consistency: Option<u16>,
    fetch_size: Option<i32>,
    is_idempotent: Option<bool>,
    request_timeout: Option<i32>,
    serial_consistency: Option<i16>,
    timestamp: Option<BigInt>,
    trace_query: Option<bool>,
) -> JsAsyncResult<QueryResultWrapper> {
    session.batch_prepared(
        env,
        statements,
        params,
        consistency,
        fetch_size,
        is_idempotent,
        request_timeout,
        serial_consistency,
        timestamp,
        trace_query,
    )
}

/// JS binding of [`SessionWrapper::query_single_page`].
#[napi(ts_return_type = "Promise<ExternalObject<QueryResultWrapper>>")]
#[allow(clippy::too_many_arguments)]
pub fn session_query_single_page(
    session: &External<SessionWrapper>,
    env: Env,
    query: String,
    params: SerializedValuesWrapper,
    consistency: Option<u16>,
    fetch_size: Option<i32>,
    is_idempotent: Option<bool>,
    request_timeout: Option<i32>,
    serial_consistency: Option<i16>,
    timestamp: Option<BigInt>,
    trace_query: Option<bool>,
    paging_state: Option<Buffer>,
) -> JsAsyncResult<QueryResultWrapper> {
    session.query_single_page(
        env,
        query,
        params,
        consistency,
        fetch_size,
        is_idempotent,
        request_timeout,
        serial_consistency,
        timestamp,
        trace_query,
        paging_state,
    )
}

/// JS binding of [`SessionWrapper::execute_prepared_single_page`].
#[napi(ts_return_type = "Promise<ExternalObject<QueryResultWrapper>>")]
#[allow(clippy::too_many_arguments)]
pub fn session_execute_prepared_single_page(
    session: &External<SessionWrapper>,
    env: Env,
    handle: &External<PreparedStatementWrapper>,
    params: SerializedValuesWrapper,
    consistency: Option<u16>,
    fetch_size: Option<i32>,
    is_idempotent: Option<bool>,
    request_timeout: Option<i32>,
    serial_consistency: Option<i16>,
    timestamp: Option<BigInt>,
    trace_query: Option<bool>,
    paging_state: Option<Buffer>,
) -> JsAsyncResult<QueryResultWrapper> {
    session.execute_prepared_single_page(
        env,
        handle,
        params,
        consistency,
        fetch_size,
        is_idempotent,
        request_timeout,
        serial_consistency,
        timestamp,
        trace_query,
        paging_state,
    )
}

#[derive(Debug)]
struct InvalidLocalDatacenter(String);

impl fmt::Display for InvalidLocalDatacenter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for InvalidLocalDatacenter {}

fn validate_local_datacenter(
    session: &scylla::client::session::Session,
    local_datacenter: Option<&str>,
) -> ConvertedResult<()> {
    let Some(local_datacenter) = local_datacenter else {
        return Ok(());
    };

    let cluster_state = session.get_cluster_state();
    // Keep the names sorted so configuration errors are deterministic.
    let available_datacenters: BTreeSet<&str> = cluster_state
        .get_nodes_info()
        .iter()
        .filter_map(|node| node.datacenter.as_deref())
        .collect();

    // An initial metadata read can fail while the Rust driver still creates a
    // session backed by dummy topology. Keep that session alive so its
    // background metadata refresh can recover it. Once any DC metadata is
    // available, reject an unknown preference instead of allowing empty plans.
    let datacenter_exists_in_ring = cluster_state
        .replica_locator()
        .unique_nodes_in_datacenter_ring(local_datacenter)
        .is_some();
    if available_datacenters.is_empty() || datacenter_exists_in_ring {
        return Ok(());
    }

    let message = if available_datacenters.contains(local_datacenter) {
        format!(
            "Datacenter {local_datacenter} was found in topology but has no nodes in the token ring"
        )
    } else {
        format!(
            "Datacenter {local_datacenter} was not found. Available DCs are: [{}]",
            available_datacenters
                .into_iter()
                .collect::<Vec<_>>()
                .join(",")
        )
    };

    Err(ConvertedError::from(InvalidLocalDatacenter(message)))
}

impl SessionWrapper {
    /// Refreshes the cached `ClusterSnapshot` if the Rust driver has produced a newer
    /// `Arc<ClusterState>` since the last access, then invokes `f` with the up-to-date snapshot,
    /// while still holding the cache's lock.
    ///
    /// `ClusterState` snapshots produced by the Rust driver are never mutated in place:
    /// whenever the driver refreshes cluster topology/schema metadata in the background,
    /// it produces a brand new `Arc<ClusterState>`, leaving any previously handed out
    /// `Arc` untouched. This lets us detect whether our cached snapshot is stale by
    /// comparing Arc pointers (`Arc::ptr_eq`):
    /// - if the pointers match, nothing changed since the last access, so we reuse the
    ///   cached `ClusterSnapshot` (avoiding rebuilding)
    /// - if the pointers differ, the snapshot is stale, so we build (and cache) a new
    ///   `ClusterSnapshot` from the fresh `Arc<ClusterState>`.
    ///
    /// This approach helps avoid any ABA problems: if the driver refreshes the cluster state
    /// multiple times between two calls to this function, we will still detect that the cached
    /// snapshot is stale, because we keep the cached `Arc` alive.
    pub(crate) fn with_cluster_snapshot<T>(
        &self,
        env: &Env,
        f: impl FnOnce(&ClusterSnapshot) -> ConvertedResult<T>,
    ) -> ConvertedResult<T> {
        let mut cache_guard = self
            .cluster_snapshot
            .lock()
            .expect("poisoning impossible due to process-aborting panics");
        let rust_cluster_state = self.inner.get_cluster_state();

        let cached_state = cache_guard.as_ref().map(|cached| cached.get(env));

        if cached_state
            .is_none_or(|cached_state| !Arc::ptr_eq(&rust_cluster_state, &cached_state.inner))
        {
            *cache_guard = Some(JsThreadOnly::new(
                ClusterSnapshot::new(rust_cluster_state, env)?,
                env,
            ));
        }

        let snapshot = cache_guard
            .as_ref()
            .expect("cluster snapshot was just initialized above, if it was previously None or the cached state was invalid")
            .get(env);

        f(snapshot)
    }
}

/// Macro to allow applying options to any query type
macro_rules! make_apply_options {
    ($statement_type: ty, $fn_name: ident) => {
        impl SessionWrapper {
            fn $fn_name(
                &self,
                mut statement: $statement_type,
                options: &QueryOptionsObj,
            ) -> ConvertedResult<$statement_type> {
                if let Some(o) = options.consistency {
                    statement.set_consistency(
                        Consistency::try_from(o).map_err(|_| {
                            make_js_error(format!("Unknown consistency value: {o}"))
                        })?,
                    );
                }

                if let Some(o) = options.serial_consistency {
                    statement.set_serial_consistency(Some(
                        SerialConsistency::try_from(o).map_err(|_| {
                            make_js_error(format!("Unknown serial consistency value: {o}"))
                        })?,
                    ));
                }

                if let Some(o) = options.is_idempotent {
                    statement.set_is_idempotent(o);
                }

                if let Some(timeout_ms) = options.request_timeout {
                    match timeout_ms {
                        0 => {
                            // `None` inherits the session profile timeout. A very long
                            // statement timeout preserves the public disabled setting.
                            statement.set_request_timeout(Some(Duration::MAX));
                        }
                        1.. => statement
                            .set_request_timeout(Some(Duration::from_millis(timeout_ms as u64))),
                        _ => {
                            return Err(ConvertedError::from(make_js_error(
                                "requestTimeout must be a non-negative integer",
                            )));
                        }
                    }
                }

                if let Some(o) = &options.timestamp {
                    statement.set_timestamp(Some(bigint_to_i64(
                        o.clone(),
                        "Timestamp cannot overflow i64",
                    )?));
                }
                // TODO: Update it to allow collection of information from traced query
                // Currently it's just passing the value, but not able to access any tracing information
                if let Some(o) = options.trace_query {
                    statement.set_tracing(o);
                }

                Ok(statement)
            }
        }
    };
}

/// Macro to allow applying options that can be used for queries other than batch
macro_rules! make_non_batch_apply_options {
    ($statement_type: ty, $fn_name: ident, $partial_name: ident) => {
        make_apply_options!($statement_type, $partial_name);
        impl SessionWrapper {
            fn $fn_name(
                &self,
                statement: $statement_type,
                options: &QueryOptionsObj,
            ) -> ConvertedResult<$statement_type> {
                // Statement with partial options applied -
                // those that are common with batch queries
                let mut statement_with_part_of_options_applied =
                    self.$partial_name(statement, options)?;
                if let Some(o) = options.fetch_size {
                    if !o.is_positive() {
                        return Err(ConvertedError::from(make_js_error(
                            "fetch size must be a positive value",
                        )));
                    }
                    statement_with_part_of_options_applied.set_page_size(o);
                }
                Ok(statement_with_part_of_options_applied)
            }
        }
    };
}

make_non_batch_apply_options!(Statement, apply_statement_options, statement_opt_partial);
make_non_batch_apply_options!(
    PreparedStatement,
    apply_prepared_statement_options,
    prepared_statement_opt_partial
);
make_apply_options!(Batch, apply_batch_options);
