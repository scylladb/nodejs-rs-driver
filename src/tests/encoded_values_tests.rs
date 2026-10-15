use scylla_cql_core::frame::types::RawValue;

use napi::Env;

use crate::async_bridge::{BridgedPromise, JsAsyncResult};
use crate::errors::ConvertedResult;
use crate::types::encoded_data::{BatchValuesWrapper, SerializedValuesWrapper};

#[napi]
pub fn tests_serialized_values(params: SerializedValuesWrapper) -> Vec<String> {
    describe_values(&params)
}

#[napi(ts_return_type = "Promise<Array<string>>")]
pub fn tests_serialized_values_async(
    env: Env,
    params: SerializedValuesWrapper,
) -> JsAsyncResult<Vec<String>> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            tokio::task::yield_now().await;
            ConvertedResult::Ok(describe_values(&params))
        })
    })
}

#[napi]
pub fn tests_batch_values(params: BatchValuesWrapper) -> Vec<Vec<String>> {
    describe_batch(&params)
}

#[napi(ts_return_type = "Promise<Array<Array<string>>>")]
pub fn tests_batch_values_async(
    env: Env,
    params: BatchValuesWrapper,
) -> JsAsyncResult<Vec<Vec<String>>> {
    BridgedPromise::spawn(&env, || {
        Ok(async move {
            tokio::task::yield_now().await;
            ConvertedResult::Ok(describe_batch(&params))
        })
    })
}

fn describe_batch(params: &BatchValuesWrapper) -> Vec<Vec<String>> {
    params.rows.iter().map(describe_values).collect()
}

fn describe_values(params: &SerializedValuesWrapper) -> Vec<String> {
    params
        .inner
        .iter()
        .map(|value| match value {
            RawValue::Null => "null".to_owned(),
            RawValue::Unset => "unset".to_owned(),
            RawValue::Value(bytes) => bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>(),
        })
        .collect()
}
