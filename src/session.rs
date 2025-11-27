use std::sync::Arc;

use openssl::ssl::{SslContextBuilder, SslMethod, SslVerifyMode};
use scylla::client::SelfIdentity;
use scylla::client::caching_session::CachingSession;
use scylla::client::session_builder::SessionBuilder;
use scylla::response::PagingState;
use scylla::statement::batch::Batch;
use scylla::statement::{Consistency, SerialConsistency, Statement};

use crate::errors::{err_to_napi, js_error};
use crate::options;
use crate::paging::{PagingResult, PagingResultWithExecutor, PagingStateWrapper};
use crate::requests::request::{QueryOptionsObj, QueryOptionsWrapper};
use crate::types::encoded_data::EncodedValuesWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::bigint_to_i64;
use crate::utils::from_napi_obj::define_js_to_rust_convertible_object;
use crate::{requests::request::PreparedStatementWrapper, result::QueryResultWrapper};

const DEFAULT_CACHE_SIZE: u32 = 512;

// For now, ssl options include only rejectUnauthorized.
// In practice, user can provide more options to configure
// the ssl connection (see: ConnectionOptions typescript class)
// This specific option is added, as it's used in the existing integration tests
#[rustfmt::skip] // fmt splits the struct definition into multiple lines
define_js_to_rust_convertible_object!(SslOptions {
    reject_unauthorized, rejectUnauthorized: bool
});

define_js_to_rust_convertible_object!(SessionOptions {
    connect_points, connectPoints: Vec<String>,
    keyspace, keyspace: String,
    application_name, applicationName: String,
    application_version, applicationVersion: String,
    credentials_username, credentialsUsername: String,
    credentials_password, credentialsPassword: String,
    cache_size, cacheSize: u32,
    ssl_options, sslOptions: SslOptions
});

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
    session: Arc<CachingSession>,
    is_prepared: bool,
}

impl QueryExecutor {
    fn new(
        session: Arc<CachingSession>,
        statement: Arc<Statement>,
        params: Arc<Vec<EncodedValuesWrapper>>,
        is_prepared: bool,
    ) -> Self {
        QueryExecutor {
            session,
            statement,
            params,
            is_prepared,
        }
    }
}

#[napi]
impl QueryExecutor {
    #[napi]
    pub async fn fetch_next_page(
        &self,
        paging_state: Option<&PagingStateWrapper>,
    ) -> napi::Result<PagingResult> {
        let paging_state = paging_state
            .map(|e| e.inner.clone())
            .unwrap_or(PagingState::start());

        let s = &self.session;
        let (result, paging_state_response) = if self.is_prepared {
            s.execute_single_page(
                Statement::clone(self.statement.as_ref()),
                self.params.as_ref(),
                paging_state,
            )
            .await
        } else {
            s.get_session()
                .query_single_page(
                    Statement::clone(self.statement.as_ref()),
                    self.params.as_ref(),
                    paging_state,
                )
                .await
        }
        .map_err(err_to_napi)?;

        Ok(PagingResult {
            result: QueryResultWrapper::from_query(result)?,
            paging_state: paging_state_response.into(),
        })
    }
}

#[napi]
impl SessionWrapper {
    /// Creates session based on the provided session options.
    #[napi]
    pub async fn create_session(options: SessionOptions) -> napi::Result<Self> {
        let builder = configure_session_builder(&options)?;
        let session = builder.build().await.map_err(err_to_napi)?;
        let session: CachingSession = CachingSession::from(
            session,
            options.cache_size.unwrap_or(DEFAULT_CACHE_SIZE) as usize,
        );
        Ok(SessionWrapper {
            inner: Arc::new(session),
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
    #[napi]
    pub async fn query_unpaged_encoded(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
    ) -> napi::Result<QueryResultWrapper> {
        let statement: Statement = apply_statement_options(query.into(), &options.options)?;
        let query_result = self
            .inner
            .get_session()
            .query_unpaged(statement, params)
            .await
            .map_err(err_to_napi)?;
        QueryResultWrapper::from_query(query_result)
    }

    /// Prepares a statement through rust driver for a given session
    /// Return expected types for the prepared statement
    #[napi]
    pub async fn prepare_statement(
        &self,
        statement: String,
    ) -> napi::Result<Vec<ComplexType<'static>>> {
        let statement: Statement = statement.into();
        let w = PreparedStatementWrapper {
            prepared: self
                .inner
                .add_prepared_statement(&statement) // TODO: change for add_prepared_statement_to_owned after it is made public
                .await
                .map_err(err_to_napi)?,
        };
        Ok(w.get_expected_types())
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
    #[napi]
    pub async fn execute_prepared_unpaged_encoded(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
    ) -> napi::Result<QueryResultWrapper> {
        let query = apply_statement_options(query.into(), &options.options)?;
        QueryResultWrapper::from_query(
            self.inner
                .execute_unpaged(query, params)
                .await
                .map_err(err_to_napi)?,
        )
    }

    /// Executes all statements in the provided batch. Those statements can be either prepared or unprepared.
    ///
    /// Returns a wrapper of the result provided by the rust driver
    #[napi]
    pub async fn batch_encoded(
        &self,
        batch: &BatchWrapper,
        params: Vec<Vec<EncodedValuesWrapper>>,
    ) -> napi::Result<QueryResultWrapper> {
        QueryResultWrapper::from_query(
            self.inner
                .batch(&batch.inner, params)
                .await
                .map_err(err_to_napi)?,
        )
    }

    /// Query a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[napi]
    pub async fn query_single_page_encoded(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> napi::Result<PagingResultWithExecutor> {
        let statement = Arc::new(apply_statement_options(query.into(), &options.options)?);

        let session = Arc::clone(&self.inner);
        let params = Arc::new(params);

        let executor = QueryExecutor::new(session, statement, params, false);

        let res = executor.fetch_next_page(paging_state).await?;

        Ok(res.with_executor(executor))
    }

    /// Execute a single page of a prepared statement
    ///
    /// For the first page, paging state is not required.
    /// For the following pages you need to provide page state
    /// received from the previous page
    #[napi]
    pub async fn execute_single_page_encoded(
        &self,
        query: String,
        params: Vec<EncodedValuesWrapper>,
        options: &QueryOptionsWrapper,
        paging_state: Option<&PagingStateWrapper>,
    ) -> napi::Result<PagingResultWithExecutor> {
        let statement = Arc::new(apply_statement_options(query.into(), &options.options)?);

        let session = Arc::clone(&self.inner);
        let params = Arc::new(params);

        let executor = QueryExecutor::new(session, statement, params, true);

        let res = executor.fetch_next_page(paging_state).await?;

        Ok(res.with_executor(executor))
    }
}

/// Creates object representing a prepared batch of statements.
/// Requires each passed statement to be already prepared.
#[napi]
pub fn create_prepared_batch(
    statements: Vec<String>,
    options: &QueryOptionsWrapper,
) -> napi::Result<BatchWrapper> {
    let mut batch: Batch = Default::default();
    statements
        .iter()
        .for_each(|q| batch.append_statement(q.as_str()));
    batch = apply_batch_options(batch, &options.options)?;
    Ok(BatchWrapper { inner: batch })
}

fn configure_session_builder(options: &SessionOptions) -> napi::Result<SessionBuilder> {
    let mut builder = SessionBuilder::new();
    builder = builder.custom_identity(self_identity(options));
    builder = builder.known_nodes(options.connect_points.as_deref().unwrap_or(&[]));
    if let Some(keyspace) = &options.keyspace {
        builder = builder.use_keyspace(keyspace, false);
    }
    match (
        options.credentials_username.as_ref(),
        options.credentials_password.as_ref(),
    ) {
        (Some(username), Some(password)) => {
            builder = builder.user(username, password);
        }
        (None, None) => (),
        (Some(_), None) | (None, Some(_)) => {
            unreachable!(
                "There is a check in JS Client constructor that should have prevented only one credential passed"
            )
        }
    }

    if let Some(ssl_options) = &options.ssl_options {
        let mut ssl_context_builder =
            SslContextBuilder::new(SslMethod::tls()).map_err(err_to_napi)?;

        ssl_context_builder.set_verify(match ssl_options.reject_unauthorized {
            Some(false) => SslVerifyMode::NONE,
            Some(true) | None => SslVerifyMode::PEER,
        });

        builder = builder.tls_context(Some(ssl_context_builder.build()));
    }
    Ok(builder)
}

/// Creates object representing unprepared batch of statements.
#[napi]
pub fn create_unprepared_batch(
    statements: Vec<String>,
    options: &QueryOptionsWrapper,
) -> napi::Result<BatchWrapper> {
    let mut batch: Batch = Default::default();
    statements
        .into_iter()
        .for_each(|q| batch.append_statement(q.as_str()));

    batch = apply_batch_options(batch, &options.options)?;
    Ok(BatchWrapper { inner: batch })
}

/// Macro to allow applying options to any query type
macro_rules! make_apply_options {
    ($statement_type: ty, $fn_name: ident) => {
        fn $fn_name(
            mut statement: $statement_type,
            options: &QueryOptionsObj,
        ) -> napi::Result<$statement_type> {
            if let Some(o) = options.consistency {
                statement.set_consistency(
                    Consistency::try_from(o)
                        .map_err(|_| js_error(format!("Unknown consistency value: {o}")))?,
                );
            }

            if let Some(o) = options.serial_consistency {
                statement
                    .set_serial_consistency(Some(SerialConsistency::try_from(o).map_err(
                        |_| js_error(format!("Unknown serial consistency value: {o}")),
                    )?));
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
    };
}

/// Macro to allow applying options that can be used for queries other than batch
macro_rules! make_non_batch_apply_options {
    ($statement_type: ty, $fn_name: ident, $partial_name: ident) => {
        make_apply_options!($statement_type, $partial_name);
        fn $fn_name(
            statement: $statement_type,
            options: &QueryOptionsObj,
        ) -> napi::Result<$statement_type> {
            // Statement with partial options applied -
            // those that are common with batch queries
            let mut statement_with_part_of_options_applied = $partial_name(statement, options)?;
            if let Some(o) = options.fetch_size {
                if !o.is_positive() {
                    return Err(js_error("fetch size must be a positive value"));
                }
                statement_with_part_of_options_applied.set_page_size(o);
            }
            Ok(statement_with_part_of_options_applied)
        }
    };
}

make_non_batch_apply_options!(Statement, apply_statement_options, statement_opt_partial);
make_apply_options!(Batch, apply_batch_options);

/// Provides driver self identity, filling information on application based on session options.
fn self_identity(options: &SessionOptions) -> SelfIdentity<'static> {
    let mut self_identity = SelfIdentity::new();
    self_identity.set_custom_driver_name(options::DEFAULT_DRIVER_NAME);
    self_identity.set_application_version(options::DEFAULT_DRIVER_VERSION);
    if let Some(app_name) = &options.application_name {
        self_identity.set_application_name(app_name.clone());
    }
    if let Some(app_version) = &options.application_name {
        self_identity.set_application_version(app_version.clone());
    }
    self_identity
}
