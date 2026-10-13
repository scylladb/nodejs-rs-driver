use std::sync::Arc;

use scylla::client::execution_profile::ExecutionProfileBuilder;
use scylla::errors::{DbError, RequestAttemptError};
use scylla::policies::load_balancing::{NodeIdentifier, SingleTargetLoadBalancingPolicy};
use scylla::policies::retry::{RequestInfo, RetryDecision, RetryPolicy, RetrySession};
use scylla::statement::Statement;
use uuid::Uuid;

use napi::Env;

use crate::async_bridge::{BridgedPromise, JsAsyncResult};
use crate::result::QueryResultWrapper;
use crate::session::SessionWrapper;
use crate::types::encoded_data::EncodedValuesWrapper;

/// Message ScyllaDB returns when a schema change collides with another one being applied at
/// (roughly) the same time.
const GROUP0_CONFLICT_MESSAGE: &str =
    "Failed to apply group 0 change due to concurrent modification";

/// How many times a DDL statement is retried after a group 0 conflict.
const MAX_DDL_RETRIES: usize = 10;

/// Retries a DDL statement, on the same target it was already sent to, when it fails
/// specifically because of a group 0 conflict. Any other error is not retried here.
#[derive(Debug, Default)]
struct DdlRetrySession {
    attempts: usize,
}

impl RetrySession for DdlRetrySession {
    fn decide_should_retry(&mut self, request_info: RequestInfo) -> RetryDecision {
        let is_group0_conflict = matches!(
            request_info.error,
            RequestAttemptError::DbError(DbError::ServerError, message)
                if message == GROUP0_CONFLICT_MESSAGE
        );
        if !is_group0_conflict {
            return RetryDecision::DontRetry;
        }

        self.attempts += 1;
        if self.attempts >= MAX_DDL_RETRIES {
            tracing::error!(
                "Received the {}th group 0 concurrent modification error during a DDL \
                 statement; giving up.",
                self.attempts
            );
            RetryDecision::DontRetry
        } else {
            tracing::warn!(
                "Received a group 0 concurrent modification error during a DDL statement; \
                 retrying (attempt #{}).",
                self.attempts
            );
            RetryDecision::RetrySameTarget(None)
        }
    }

    fn reset(&mut self) {
        *self = Self::default();
    }
}

#[derive(Debug)]
struct DdlRetryPolicy;

impl RetryPolicy for DdlRetryPolicy {
    fn new_session(&self) -> Box<dyn RetrySession> {
        Box::new(DdlRetrySession::default())
    }
}

fn apply_ddl_lbp(statement: &mut Statement, host_id: Uuid) {
    let profile = ExecutionProfileBuilder::default()
        .load_balancing_policy(SingleTargetLoadBalancingPolicy::new(
            NodeIdentifier::HostId(host_id),
            Some(0),
        ))
        .retry_policy(Arc::new(DdlRetryPolicy))
        .build();
    statement.set_execution_profile_handle(Some(profile.into_handle()));
}

/// Helper for executing DDL statements in tests.
#[napi(ts_return_type = "Promise<QueryResultWrapper>")]
pub fn ddl(env: Env, session: &SessionWrapper, query: String) -> JsAsyncResult<QueryResultWrapper> {
    let session = Arc::clone(&session.inner);
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            let inner_session = session;
            let target_host_id = inner_session
                .get_cluster_state()
                .get_nodes_info()
                .first()
                .map(|node| node.host_id);

            let mut statement: Statement = query.into();
            if let Some(host_id) = target_host_id {
                apply_ddl_lbp(&mut statement, host_id);
            }

            let result = inner_session
                .query_unpaged(statement, Vec::<EncodedValuesWrapper>::new())
                .await?;
            QueryResultWrapper::from_unprepared_or_batch(result, None)
        })
    })
}
