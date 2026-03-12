pub mod config;
use std::sync::Arc;

use crate::async_bridge::{JsAsyncResult, submit_future};
use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_sync,
};
use crate::paging::{PagingResult, PagingResultWithExecutor, PagingStateWrapper};
use crate::requests::request::{QueryOptionsObj, QueryOptionsWrapper};
use crate::session::config::{SessionOptions, configure_session_builder};
use crate::types::encoded_data::EncodedValuesWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::bigint_to_i64;
use crate::{requests::request::PreparedStatementWrapper, result::QueryResultWrapper};
use napi::bindgen_prelude::Env;
use scylla::client::caching_session::CachingSession;
use scylla::response::{PagingState, PagingStateResponse};
use scylla::statement::batch::Batch;
use scylla::statement::{Consistency, SerialConsistency, Statement};

const DEFAULT_CACHE_SIZE: u32 = 512;

#[napi]
pub struct BatchWrapper {
    inner: Batch,
}

#[napi]
pub struct SessionWrapper {
    pub(crate) inner: Arc<CachingSession>,
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

#[napi]
impl QueryExecutor {
    #[napi(ts_return_type = "Promise<PagingResult>")]
    pub fn fetch_next_page(
        &self,
        env: Env,
        session: &SessionWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> JsAsyncResult<PagingResult> {
        with_custom_error_sync(|| {
            let params = Arc::clone(&self.params);
            let statement = Arc::clone(&self.statement);
            let is_prepared = self.is_prepared;
            let session_inner = Arc::clone(&session.inner);
            let paging_state_inner = paging_state.map(|p| p.inner.clone());
            submit_future(&env, async move {
                let paging_state = paging_state_inner.unwrap_or(PagingState::start());
                let (result, paging_state_response) = if is_prepared {
                    session_inner
                        .execute_single_page(
                            Statement::clone(statement.as_ref()),
                            params.as_ref(),
                            paging_state,
                        )
                        .await
                } else {
                    session_inner
                        .get_session()
                        .query_single_page(
                            Statement::clone(statement.as_ref()),
                            params.as_ref(),
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
            })
        })
    }
}

#[napi]
impl SessionWrapper {
    /// Creates session based on the provided session options.
    #[napi(ts_return_type = "Promise<SessionWrapper>")]
    pub fn create_session(
        env: Env,
        options: SessionOptions,
    ) -> JsAsyncResult<SessionWrapper> {
        with_custom_error_sync(|| {
            submit_future(&env, async move {
                let cache_size = options.cache_size.unwrap_or(DEFAULT_CACHE_SIZE) as usize;
                let builder = configure_session_builder(options)?;
                let session = builder.build().await?;
                let session: CachingSession = CachingSession::from(session, cache_size);
                Ok(SessionWrapper {
                    inner: Arc::new(session),
                })
            })
        })
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
    pub fn query_unpaged_encoded(
        &self,
        env: Env,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
    ) -> JsAsyncResult<QueryResultWrapper> {
        with_custom_error_sync(|| {
            let statement = self.apply_statement_options(query.into(), &options.options)?;
            let inner = Arc::clone(&self.inner);
            submit_future(&env, async move {
                let query_result = inner.get_session().query_unpaged(statement, params).await?;
                QueryResultWrapper::from_query(query_result)
            })
        })
    }

    /// Prepares a statement through rust driver for a given session.
    /// Returns (expected type, variable name) pairs for the prepared statement.
    #[napi(ts_return_type = "Promise<Array<[ComplexType, string]>>")]
    pub fn prepare_statement(
        &self,
        env: Env,
        statement: String,
    ) -> JsAsyncResult<Vec<(ComplexType<'static>, String)>> {
        with_custom_error_sync(|| {
            let statement: Statement = statement.into();
            let inner = Arc::clone(&self.inner);
            submit_future(&env, async move {
                let w = PreparedStatementWrapper {
                    prepared: inner
                        .add_prepared_statement(&statement) // TODO: change for add_prepared_statement_to_owned after it is made public
                        .await?,
                };
                let types = w.get_expected_types();
                ConvertedResult::Ok(types)
            })
        })
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
    pub fn execute_prepared_unpaged_encoded(
        &self,
        env: Env,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
    ) -> JsAsyncResult<QueryResultWrapper> {
        with_custom_error_sync(|| {
            let query = self.apply_statement_options(query.into(), &options.options)?;
            let inner = Arc::clone(&self.inner);
            submit_future(&env, async move {
                QueryResultWrapper::from_query(inner.execute_unpaged(query, params).await?)
            })
        })
    }

    /// Executes all statements in the provided batch. Those statements can be either prepared or unprepared.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    #[napi(ts_return_type = "Promise<QueryResultWrapper>")]
    pub fn batch_encoded(
        &self,
        env: Env,
        batch: &BatchWrapper,
        params: Vec<Vec<EncodedValuesWrapper>>,
    ) -> JsAsyncResult<QueryResultWrapper> {
        with_custom_error_sync(|| {
            let batch = batch.inner.clone();
            let inner = Arc::clone(&self.inner);
            submit_future(&env, async move {
                QueryResultWrapper::from_query(inner.batch(&batch, params).await?)
            })
        })
    }

    /// Query a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[napi(ts_return_type = "Promise<PagingResultWithExecutor>")]
    pub fn query_single_page_encoded(
        &self,
        env: Env,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> JsAsyncResult<PagingResultWithExecutor> {
        with_custom_error_sync(|| {
            let statement = Arc::new(self.apply_statement_options(query.into(), &options.options)?);
            let params = Arc::new(params);
            let paging_state_inner = paging_state.map(|p| p.inner.clone());
            let inner = Arc::clone(&self.inner);
            submit_future(&env, async move {
                let paging_state = paging_state_inner.unwrap_or(PagingState::start());
                let (result, paging_state_response) = inner
                    .get_session()
                    .query_single_page(
                        Statement::clone(statement.as_ref()),
                        params.as_ref(),
                        paging_state,
                    )
                    .await?;
                let paging_result = PagingResult {
                    result: QueryResultWrapper::from_query(result)?,
                    paging_state: match paging_state_response {
                        PagingStateResponse::HasMorePages { state } => {
                            Some(PagingStateWrapper { inner: state })
                        }
                        PagingStateResponse::NoMorePages => None,
                    },
                };
                let executor = QueryExecutor::new(statement, params, false);
                Ok(paging_result.with_executor(executor))
            })
        })
    }

    /// Execute a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[napi(ts_return_type = "Promise<PagingResultWithExecutor>")]
    pub fn execute_single_page_encoded(
        &self,
        env: Env,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> JsAsyncResult<PagingResultWithExecutor> {
        with_custom_error_sync(|| {
            let statement = Arc::new(self.apply_statement_options(query.into(), &options.options)?);
            let params = Arc::new(params);
            let paging_state_inner = paging_state.map(|p| p.inner.clone());
            let inner = Arc::clone(&self.inner);
            submit_future(&env, async move {
                let paging_state = paging_state_inner.unwrap_or(PagingState::start());
                let (result, paging_state_response) = inner
                    .execute_single_page(
                        Statement::clone(statement.as_ref()),
                        params.as_ref(),
                        paging_state,
                    )
                    .await?;
                let paging_result = PagingResult {
                    result: QueryResultWrapper::from_query(result)?,
                    paging_state: match paging_state_response {
                        PagingStateResponse::HasMorePages { state } => {
                            Some(PagingStateWrapper { inner: state })
                        }
                        PagingStateResponse::NoMorePages => None,
                    },
                };
                let executor = QueryExecutor::new(statement, params, true);
                Ok(paging_result.with_executor(executor))
            })
        })
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
