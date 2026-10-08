use scylla_cql_core::frame::types::RawValue;

use crate::types::encoded_data::SerializedValuesWrapper;

#[napi]
pub fn tests_serialized_values(params: SerializedValuesWrapper) -> Vec<String> {
    describe_values(&params)
}

#[napi]
pub async fn tests_serialized_values_async(params: SerializedValuesWrapper) -> Vec<String> {
    tokio::task::yield_now().await;
    describe_values(&params)
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
