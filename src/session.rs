pub mod config;
use std::collections::BTreeSet;
use std::fmt;
use std::sync::{Arc, Mutex};

use config::SessionOptions;
use napi::Env;
use scylla::client::caching_session::CachingSession;
use scylla::response::{PagingState, PagingStateResponse};
use scylla::statement::batch::Batch;
use scylla::statement::{Consistency, SerialConsistency, Statement};

use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_async,
    with_custom_error_sync,
};
use crate::metadata::state::ClusterSnapshot;
use crate::paging::{PagingResult, PagingResultWithExecutor, PagingStateWrapper};
use crate::requests::request::{QueryOptionsObj, QueryOptionsWrapper};
use crate::session::config::configure_session_builder;
use crate::types::encoded_data::EncodedValuesWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::bigint_to_i64;
use crate::utils::js_thread_only::JsThreadOnly;
use crate::{requests::request::PreparedStatementWrapper, result::QueryResultWrapper};

const DEFAULT_CACHE_SIZE: u32 = 512;

#[napi]
pub struct BatchWrapper {
    inner: Batch,
}

#[napi]
pub struct SessionWrapper {
    pub(crate) inner: CachingSession,
    /// Cache of the last `ClusterSnapshot` that was computed, alongside the `Arc<ClusterState>`
    /// pointer it was built from.
    cluster_snapshot: Mutex<Option<JsThreadOnly<ClusterSnapshot>>>,
}

/// This object allows executing queries for following pages of the result,
/// without the need to pass the statement and parameters multiple times.
/// This structure is tied to specific session.
#[napi]
pub struct QueryExecutor {
    params: Arc<Vec<EncodedValuesWrapper>>,
    statement: Arc<Statement>,
    is_prepared: bool,
}

impl QueryExecutor {
    fn new(
        statement: Arc<Statement>,
        params: Arc<Vec<EncodedValuesWrapper>>,
        is_prepared: bool,
    ) -> Self {
        QueryExecutor {
            statement,
            params,
            is_prepared,
        }
    }
}

impl QueryExecutor {
    async fn fetch_next_page_internal(
        &self,
        session: &SessionWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> ConvertedResult<PagingResult> {
        let paging_state = paging_state
            .map(|e| e.inner.clone())
            .unwrap_or(PagingState::start());

        let (result, paging_state_response) = if self.is_prepared {
            session
                .inner
                .execute_single_page(
                    Statement::clone(self.statement.as_ref()),
                    self.params.as_ref(),
                    paging_state,
                )
                .await
        } else {
            session
                .inner
                .get_session()
                .query_single_page(
                    Statement::clone(self.statement.as_ref()),
                    self.params.as_ref(),
                    paging_state,
                )
                .await
        }?;

        Ok(PagingResult {
            result: QueryResultWrapper::from_query(result)?,
            paging_state: match paging_state_response {
                PagingStateResponse::HasMorePages { state } => {
                    Some(PagingStateWrapper { inner: state })
                }
                PagingStateResponse::NoMorePages => None,
            },
        })
    }
}
#[napi]
impl QueryExecutor {
    #[napi(ts_return_type = "Promise<PagingResult>")]
    pub async fn fetch_next_page(
        &self,
        session: &SessionWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> JsResult<PagingResult> {
        with_custom_error_async(async || self.fetch_next_page_internal(session, paging_state).await)
            .await
    }
}

#[napi]
impl SessionWrapper {
    /// Creates session based on the provided session options.
    #[napi(ts_return_type = "Promise<SessionWrapper>")]
    pub async fn create_session(options: SessionOptions) -> JsResult<SessionWrapper> {
        with_custom_error_async(async || {
            let cache_size = options.cache_size.unwrap_or(DEFAULT_CACHE_SIZE) as usize;
            let local_datacenter = options.local_datacenter.clone();
            let builder = configure_session_builder(options)?;
            let session = builder.build().await?;
            validate_local_datacenter(&session, local_datacenter.as_deref())?;
            let session: CachingSession = CachingSession::from(session, cache_size);
            ConvertedResult::Ok(SessionWrapper {
                inner: session,
                cluster_snapshot: Mutex::new(None),
            })
        })
        .await
    }

    /// Returns the name of the current keyspace
    #[napi]
    pub fn get_keyspace(&self) -> Option<String> {
        self.inner
            .get_session()
            .get_keyspace()
            .as_deref()
            .map(ToOwned::to_owned)
    }

    /// Checks whether all nodes that are currently up agree on the schema version.
    ///
    /// This is a one-time check, without any form of retry.
    ///
    /// Failing to perform the check is not reported as an error: the Rust driver's failure is
    /// logged as a warning (and thus reaches the client's log emitter through the logging
    /// bridge) and reported as "no agreement".
    #[napi(ts_return_type = "Promise<boolean>")]
    pub async fn check_schema_agreement(&self) -> bool {
        match self.inner.get_session().check_schema_agreement().await {
            Ok(agreed_version) => agreed_version.is_some(),
            Err(err) => {
                tracing::warn!("There was an error while checking the schema agreement: {err}");
                false
            }
        }
    }

    /// Waits until all currently reachable nodes agree on the schema version.
    ///
    /// Unlike `check_schema_agreement`, which performs a single, non-retrying check and never
    /// fails, this retries at the driver's `schema_agreement_interval` until agreement is
    /// reached or `schema_agreement_timeout` elapses, rejecting if agreement could not be
    /// reached in time - or could not be checked at all, for example if no node is reachable.
    #[napi(ts_return_type = "Promise<void>")]
    pub async fn wait_for_schema_agreement(&self) -> JsResult<()> {
        with_custom_error_async(async || {
            self.inner.get_session().await_schema_agreement().await?;
            ConvertedResult::Ok(())
        })
        .await
    }

    /// Executes unprepared statement. This assumes the types will be either guessed or provided by user.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    ///
    /// All parameters must be in a type recognizable by ParameterWrapper
    /// -- each value must be tuple of its ComplexType and the value itself.
    /// If the provided types will not be correct, this query will fail.
    #[napi(ts_return_type = "Promise<QueryResultWrapper>")]
    pub async fn query_unpaged(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
    ) -> JsResult<QueryResultWrapper> {
        with_custom_error_async(async || {
            let statement: Statement =
                self.apply_statement_options(query.into(), &options.options)?;
            let query_result = self
                .inner
                .get_session()
                .query_unpaged(statement, params)
                .await?;
            QueryResultWrapper::from_query(query_result)
        })
        .await
    }

    /// Prepares a statement through rust driver for a given session.
    /// Returns (expected type, variable name) pairs for the prepared statement.
    #[napi(ts_return_type = "Promise<Array<[ComplexType, string]>>")]
    pub async fn prepare_statement(
        &self,
        statement: String,
    ) -> JsResult<Vec<(ComplexType<'static>, String)>> {
        with_custom_error_async(async || {
            let statement: Statement = statement.into();
            let w = PreparedStatementWrapper {
                prepared: self
                    .inner
                    .add_prepared_statement(&statement) // TODO: change for add_prepared_statement_to_owned after it is made public
                    .await?,
            };
            let types = w.get_expected_types();
            ConvertedResult::Ok(types)
        })
        .await
    }

    /// Execute a given prepared statement against the database with provided parameters.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    ///
    /// All parameters must be in a type recognizable by ParameterWrapper
    /// -- each value must be tuple of its ComplexType and the value itself.
    /// Creating Prepared statement may help to determine required types
    ///
    /// Currently `execute_unpaged` from rust driver is used, so no paging is done
    /// and there is no support for any query options
    #[napi(ts_return_type = "Promise<QueryResultWrapper>")]
    pub async fn execute_prepared_unpaged(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
    ) -> JsResult<QueryResultWrapper> {
        with_custom_error_async(async || {
            let query = self.apply_statement_options(query.into(), &options.options)?;
            QueryResultWrapper::from_query(self.inner.execute_unpaged(query, params).await?)
        })
        .await
    }

    /// Executes all statements in the provided batch. Those statements can be either prepared or unprepared.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    #[napi(ts_return_type = "Promise<QueryResultWrapper>")]
    pub async fn batch(
        &self,
        batch: &BatchWrapper,
        params: Vec<Vec<EncodedValuesWrapper>>,
    ) -> JsResult<QueryResultWrapper> {
        with_custom_error_async(async || {
            let res = self.inner.batch(&batch.inner, params).await?;
            QueryResultWrapper::from_query(res)
        })
        .await
    }

    /// Query a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[napi(ts_return_type = "Promise<PagingResultWithExecutor>")]
    pub async fn query_single_page(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> JsResult<PagingResultWithExecutor> {
        with_custom_error_async(async || {
            let statement = Arc::new(self.apply_statement_options(query.into(), &options.options)?);

            let params = Arc::new(params);

            let executor = QueryExecutor::new(statement, params, false);

            let res = executor
                .fetch_next_page_internal(self, paging_state)
                .await?;

            ConvertedResult::Ok(res.with_executor(executor))
        })
        .await
    }

    /// Execute a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[napi(ts_return_type = "Promise<PagingResultWithExecutor>")]
    pub async fn execute_single_page(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> JsResult<PagingResultWithExecutor> {
        with_custom_error_async(async || {
            let statement = Arc::new(self.apply_statement_options(query.into(), &options.options)?);

            let params = Arc::new(params);

            let executor = QueryExecutor::new(statement, params, true);

            let res = executor
                .fetch_next_page_internal(self, paging_state)
                .await?;

            ConvertedResult::Ok(res.with_executor(executor))
        })
        .await
    }

    /// Creates object representing batch of statements.
    #[napi(ts_return_type = "BatchWrapper")]
    pub fn create_batch(
        &self,
        statements: Vec<String>,
        options: &QueryOptionsWrapper,
    ) -> JsResult<BatchWrapper> {
        with_custom_error_sync(|| {
            let mut batch: Batch = Default::default();
            statements
                .into_iter()
                .for_each(|q| batch.append_statement(q.as_str()));

            batch = self.apply_batch_options(batch, &options.options)?;
            ConvertedResult::Ok(BatchWrapper { inner: batch })
        })
    }
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
        let rust_cluster_state = self.inner.get_session().get_cluster_state();

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
make_apply_options!(Batch, apply_batch_options);
