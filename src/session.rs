pub mod config;
use std::sync::Arc;

use config::SessionOptions;
use scylla::client::caching_session::CachingSession;
use scylla::response::{PagingState, PagingStateResponse};
use scylla::statement::batch::Batch;
use scylla::statement::{Consistency, SerialConsistency, Statement};

use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_async,
    with_custom_error_sync,
};
use crate::paging::{PagingResult, PagingResultWithExecutor, PagingStateWrapper};
use crate::requests::request::{QueryOptionsObj, QueryOptionsWrapper};
use crate::session::config::configure_session_builder;
use crate::types::encoded_data::EncodedValuesWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::bigint_to_i64;
use crate::{requests::request::PreparedStatementWrapper, result::QueryResultWrapper};

const DEFAULT_CACHE_SIZE: u32 = 512;

#[napi]
pub struct BatchWrapper {
    inner: Batch,
}

/// A `napi::bindgen_prelude::Reference<T>` (and other N-API handles built on top of it) can only
/// ever be safely created, read, or dropped on the thread that owns the JS engine it was created
/// for. Because of that, `Reference<T>` is (rightfully) not `Send`.
///
/// However, `SessionWrapper` also exposes `async` methods (e.g. `query_unpaged`), and for those
/// to compile, `&SessionWrapper` must be `Send`, which in turn requires every field of
/// `SessionWrapper` - including our cached `Reference<ClusterSnapshot>` - to be `Sync`.
/// None of those `async` methods ever touch the cached cluster state though: it is only ever
/// read or written from the synchronous `get_cluster_snapshot`/`get_all_hosts` methods, which N-API
/// always calls on the JS thread. This wrapper asserts `Send`/`Sync` to satisfy the compiler in
/// that case.
///
/// # Safety
/// Values of this type must only be constructed, read, or dropped from the JS thread
/// (i.e. from within a synchronous `#[napi]` function, or a finalizer callback - both of which
/// N-API always runs on the JS thread). Do not read or drop this from within an `async` method.
#[expect(unused)]
struct JsThreadOnly<T>(T);

unsafe impl<T> Send for JsThreadOnly<T> {}
unsafe impl<T> Sync for JsThreadOnly<T> {}

#[napi]
pub struct SessionWrapper {
    pub(crate) inner: CachingSession,
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
            let builder = configure_session_builder(options)?;
            let session = builder.build().await?;
            let session: CachingSession = CachingSession::from(session, cache_size);
            ConvertedResult::Ok(SessionWrapper { inner: session })
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
