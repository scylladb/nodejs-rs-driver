use napi::Env;
use napi::bindgen_prelude::External;
use napi::bindgen_prelude::{BigInt, FnArgs};

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error};
use crate::session::SessionWrapper;
use crate::types::encoded_data::SerializedValuesWrapper;
use crate::utils::js_ctor::{build_token, js_constructible_class};
use crate::utils::js_instance::JsInstance;

impl SessionWrapper {
    /// Computes the token of a partition key of the given table, given the already-serialized
    /// values of the key's columns, in one buffer (see [`SerializedValuesWrapper`]).
    ///
    /// It is the caller's responsibility to pass values that really are the partition key's
    /// columns, in order, each encoded with the CQL type of its column.
    pub fn compute_token<'env>(
        &self,
        env: &'env Env,
        components: SerializedValuesWrapper,
        keyspace: String,
        table: String,
    ) -> JsResult<JsInstance<'env, js_constructible_class::Token>> {
        with_custom_error(|| {
            self.with_cluster_snapshot(env, |snapshot| {
                let token = snapshot.inner.compute_token_preserialized(
                    &keyspace,
                    &table,
                    &components.inner,
                )?;
                let value = BigInt::from(token.value());
                build_token(env, FnArgs::from((value,))).map_err(ConvertedError::from)
            })
        })
    }
}

// JS reads the session with these functions. See [`SessionWrapper`].

/// JS binding of [`SessionWrapper::compute_token`].
#[napi(ts_return_type = "import('./lib/token').Token")]
pub fn session_compute_token<'env>(
    session: &External<SessionWrapper>,
    env: &'env Env,
    components: SerializedValuesWrapper,
    keyspace: String,
    table: String,
) -> JsResult<JsInstance<'env, js_constructible_class::Token>> {
    session.compute_token(env, components, keyspace, table)
}

impl SessionWrapper {
    /// Returns every token of the cluster's token ring, sorted ascending. Each adjacent pair is one
    /// range of the ring, the last pair wrapping from the highest token back to the lowest.
    pub fn get_ring_tokens<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<Vec<JsInstance<'env, js_constructible_class::Token>>> {
        with_custom_error(|| {
            self.with_cluster_snapshot(env, |snapshot| {
                snapshot
                    .inner
                    .replica_locator()
                    .ring()
                    .iter()
                    .map(|(token, _)| {
                        build_token(env, FnArgs::from((BigInt::from(token.value()),)))
                            .map_err(ConvertedError::from)
                    })
                    .collect::<ConvertedResult<Vec<_>>>()
            })
        })
    }
}

// JS reads the session with these functions. See [`SessionWrapper`].

/// JS binding of [`SessionWrapper::get_ring_tokens`].
#[napi(ts_return_type = "import('./lib/token').Token[]")]
pub fn session_get_ring_tokens<'env>(
    session: &External<SessionWrapper>,
    env: &'env Env,
) -> JsResult<Vec<JsInstance<'env, js_constructible_class::Token>>> {
    session.get_ring_tokens(env)
}
