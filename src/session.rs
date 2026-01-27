use std::sync::Arc;

use napi::bindgen_prelude::BigInt;
use openssl::ssl::{
    SslContext, SslContextBuilder, SslMethod, SslOptions as OpenSslOptions, SslVerifyMode,
    SslVersion,
};
use openssl::x509::X509;
use openssl::x509::store::X509StoreBuilder;
use scylla::client::SelfIdentity;
use scylla::client::caching_session::CachingSession;
use scylla::client::execution_profile::ExecutionProfileBuilder;
use scylla::client::session_builder::SessionBuilder;
use scylla::policies::host_filter::AllowListHostFilter;
use scylla::policies::load_balancing::{self, LoadBalancingPolicy};
use scylla::response::{PagingState, PagingStateResponse};
use scylla::statement::batch::Batch;
use scylla::statement::{Consistency, SerialConsistency, Statement};

use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_async,
    with_custom_error_sync,
};
use crate::options;
use crate::paging::{PagingResult, PagingResultWithExecutor, PagingStateWrapper};
use crate::requests::request::{QueryOptionsObj, QueryOptionsWrapper};
use crate::types::encoded_data::EncodedValuesWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::bigint_to_i64;
use crate::utils::from_napi_obj::define_js_to_rust_convertible_object;
use crate::{requests::request::PreparedStatementWrapper, result::QueryResultWrapper};

const DEFAULT_CACHE_SIZE: u32 = 512;

#[derive(Debug, PartialEq, Eq)]
#[napi]
pub enum TlsVersion {
    Tlsv1,
    Tlsv1_1,
    Tlsv1_2,
    Tlsv1_3,
}

// We assume here, that for the fields that allow multiple types on the JS side,
// they will be converted to a type specified here, before passing to Rust side.
#[rustfmt::skip] // fmt splits each field definition into multiple lines
define_js_to_rust_convertible_object!(SslOptions {
    ca, ca: Vec<String>,
    cert, cert: String,
    sigalgs, sigalgs: String,
    ciphers, ciphers: String,
    ecdh_curve, ecdhCurve: String,
    honor_cipher_order, honorCipherOrder: bool,
    key, key: String,
    max_version, maxVersion: TlsVersion,
    min_version, minVersion: TlsVersion,
    passphrase, passphrase: String,
    pfx, pfx: String,
    secure_options, secureOptions: BigInt,
    session_id_context, sessionIdContext: String,
    reject_unauthorized, rejectUnauthorized: bool,
});

#[rustfmt::skip] // fmt splits each field definition into multiple lines
define_js_to_rust_convertible_object!(
LoadBalancingConfig {
    prefer_datacenter, preferDatacenter: String,
    prefer_rack, preferRack: String,
    token_aware, tokenAware: bool,
    permit_dc_failover, permitDcFailover: bool,
    enable_shuffling_replicas, enableShufflingReplicas: bool,
    allow_list, allowList: Vec<String>,
    
});

define_js_to_rust_convertible_object!(SessionOptions {
    connect_points, connectPoints: Vec<String>,
    keyspace, keyspace: String,
    application_name, applicationName: String,
    application_version, applicationVersion: String,
    client_id, clientId: String,
    credentials_username, credentialsUsername: String,
    credentials_password, credentialsPassword: String,
    cache_size, cacheSize: u32,
    ssl_options, sslOptions: SslOptions,
    load_balancing_config, loadBalancingConfig: LoadBalancingConfig,
});

#[napi]
pub struct BatchWrapper {
    inner: Batch,
}

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
    #[napi]
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
    #[napi]
    pub async fn create_session(options: SessionOptions) -> JsResult<SessionWrapper> {
        with_custom_error_async(async || {
            let builder = configure_session_builder(&options)?;
            let session = builder.build().await?;
            let session: CachingSession = CachingSession::from(
                session,
                options.cache_size.unwrap_or(DEFAULT_CACHE_SIZE) as usize,
            );
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
    #[napi]
    pub async fn query_unpaged_encoded(
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

    /// Prepares a statement through rust driver for a given session
    /// Return expected types for the prepared statement
    #[napi]
    pub async fn prepare_statement(
        &self,
        statement: String,
    ) -> JsResult<Vec<ComplexType<'static>>> {
        with_custom_error_async(async || {
            let statement: Statement = statement.into();
            let w = PreparedStatementWrapper {
                prepared: self
                    .inner
                    .add_prepared_statement(&statement) // TODO: change for add_prepared_statement_to_owned after it is made public
                    .await?,
            };
            ConvertedResult::Ok(w.get_expected_types())
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
    #[napi]
    pub async fn execute_prepared_unpaged_encoded(
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
    #[napi]
    pub async fn batch_encoded(
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
    #[napi]
    pub async fn query_single_page_encoded(
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
    #[napi]
    pub async fn execute_single_page_encoded(
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
    #[napi]
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

fn tls_version_to_ssl_version(version: &TlsVersion) -> SslVersion {
    match version {
        TlsVersion::Tlsv1 => SslVersion::TLS1,
        TlsVersion::Tlsv1_1 => SslVersion::TLS1_1,
        TlsVersion::Tlsv1_2 => SslVersion::TLS1_2,
        TlsVersion::Tlsv1_3 => SslVersion::TLS1_3,
    }
}

fn configure_ssl(options: &SslOptions) -> ConvertedResult<Option<SslContext>> {
    let mut ssl_context_builder = SslContextBuilder::new(SslMethod::tls())?;

    ssl_context_builder.set_verify(match options.reject_unauthorized {
        Some(false) => SslVerifyMode::NONE,
        Some(true) | None => SslVerifyMode::PEER,
    });

    if let Some(min_version) = &options.min_version {
        let ssl_version = tls_version_to_ssl_version(min_version);
        ssl_context_builder.set_min_proto_version(Some(ssl_version))?;
    }

    if let Some(max_version) = &options.max_version {
        let ssl_version = tls_version_to_ssl_version(max_version);
        ssl_context_builder.set_max_proto_version(Some(ssl_version))?;
    }

    if let Some(sigalgs) = &options.sigalgs {
        ssl_context_builder.set_sigalgs_list(sigalgs)?;
    }

    if let Some(session_id_context) = &options.session_id_context {
        ssl_context_builder.set_session_id_context(session_id_context.as_bytes())?;
    }

    if let Some(ecdh_curve) = &options.ecdh_curve {
        ssl_context_builder.set_groups_list(ecdh_curve)?;
    }

    if let Some(secure_options) = &options.secure_options {
        let (negative, flags, overflow) = secure_options.get_u64();
        if negative || overflow {
            return Err(ConvertedError::from(make_js_error(format!(
                "secureOptions must be a non-negative integer within u64 range, got {:?}",
                secure_options
            ))));
        }
        ssl_context_builder.set_options(OpenSslOptions::from_bits_truncate(flags));
    }

    if let Some(true) = options.honor_cipher_order {
        ssl_context_builder.set_options(OpenSslOptions::CIPHER_SERVER_PREFERENCE);
    }

    if let Some(ca_list) = &options.ca {
        let mut store_builder = X509StoreBuilder::new()?;
        for ca_pem in ca_list {
            let ca = X509::from_pem(ca_pem.as_bytes())?;
            store_builder.add_cert(ca)?;
        }
        ssl_context_builder.set_cert_store(store_builder.build());
    }

    Ok(Some(ssl_context_builder.build()))
}

fn configure_session_builder(options: &SessionOptions) -> ConvertedResult<SessionBuilder> {
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
        builder = builder.tls_context(configure_ssl(ssl_options)?);
    }

    if let Some(allow_list) = options
        .load_balancing_config
        .as_ref()
        .and_then(|c| c.allow_list.as_ref())
    {
        let host_filter = Arc::new(AllowListHostFilter::new(allow_list)?);
        builder = builder.host_filter(host_filter);
    }

    let mut exec_profile_builder = ExecutionProfileBuilder::default();
    if let Some(load_balancing_policy) =
        create_load_balancing_policy(&options.load_balancing_config)?
    {
        exec_profile_builder = exec_profile_builder.load_balancing_policy(load_balancing_policy);
    }
    builder = builder.default_execution_profile_handle(exec_profile_builder.build().into_handle());
    Ok(builder)
}

fn create_load_balancing_policy(
    config: &Option<LoadBalancingConfig>,
) -> napi::Result<Option<Arc<dyn LoadBalancingPolicy>>> {
    let Some(config) = config else {
        return Ok(None);
    };

    let mut builder = load_balancing::DefaultPolicyBuilder::new();

    match (&config.prefer_datacenter, &config.prefer_rack) {
        (Some(dc), None) => {
            builder = builder.prefer_datacenter(dc.to_owned());
        }
        (Some(dc), Some(rack)) => {
            builder = builder.prefer_datacenter_and_rack(dc.to_owned(), rack.to_owned());
        }
        (None, Some(_)) => {
            return Err(make_js_error(
                "Rack preference cannot be set without setting dc preference",
            ));
        }
        (None, None) => {}
    }

    if let Some(token_aware) = config.token_aware {
        builder = builder.token_aware(token_aware);
    }
    if let Some(permit_dc_failover) = config.permit_dc_failover {
        builder = builder.permit_dc_failover(permit_dc_failover);
    }
    if let Some(enable_shuffling_replicas) = config.enable_shuffling_replicas {
        builder = builder.enable_shuffling_replicas(enable_shuffling_replicas);
    }

    Ok(Some(builder.build()))
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
    if let Some(client_id) = &options.client_id {
        self_identity.set_client_id(client_id.to_owned());
    }
    self_identity
}
