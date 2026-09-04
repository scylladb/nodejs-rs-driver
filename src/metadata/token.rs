use napi::Env;
use napi::bindgen_prelude::{BigInt, FnArgs};
use scylla::cluster::metadata::{ColumnType, NativeType};
use scylla::serialize::SerializationError;
use scylla::serialize::row::{RowSerializationContext, SerializeRow};
use scylla::serialize::value::SerializeValue;
use scylla::serialize::writers::RowWriter;

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error_sync};
use crate::session::SessionWrapper;
use crate::types::encoded_data::EncodedValuesWrapper;
use crate::utils::js_ctor::{build_token, js_constructible_class};
use crate::utils::js_instance::JsInstance;

/// The column type reported for an already-encoded partition key column.
///
/// Nothing reads it to drive an encoding – it only ever names the value in an error message.
const PREENCODED_COLUMN_TYPE: ColumnType<'static> = ColumnType::Native(NativeType::Blob);

/// The values of a partition key's columns, already converted into their CQL binary form by the
/// JS side, in the order the table declares them.
struct PreSerializedPartitionKey(Vec<EncodedValuesWrapper>);

impl SerializeRow for PreSerializedPartitionKey {
    fn serialize(
        &self,
        _ctx: &RowSerializationContext<'_>,
        writer: &mut RowWriter,
    ) -> Result<(), SerializationError> {
        for component in &self.0 {
            component.serialize(&PREENCODED_COLUMN_TYPE, writer.make_cell_writer())?;
        }
        Ok(())
    }

    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[napi]
impl SessionWrapper {
    /// Computes the token of a partition key of the given table, given the already-serialized
    /// values of the key's columns.
    ///
    /// It is the caller's responsibility to pass values that really are the partition key's
    /// columns, in order, each encoded with the CQL type of its column.
    #[napi(ts_return_type = "import('./lib/token').Token")]
    pub fn compute_token<'env>(
        &self,
        env: &'env Env,
        components: Vec<EncodedValuesWrapper>,
        keyspace: String,
        table: String,
    ) -> JsResult<JsInstance<'env, js_constructible_class::Token>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot| {
                let partition_key = PreSerializedPartitionKey(components);
                let token = snapshot
                    .inner
                    .compute_token(&keyspace, &table, &partition_key)?;
                let value = BigInt::from(token.value());
                build_token(env, FnArgs::from((value,))).map_err(ConvertedError::from)
            })
        })
    }
}

#[napi]
impl SessionWrapper {
    /// Returns every token of the cluster's token ring, sorted ascending. Each adjacent pair is one
    /// range of the ring, the last pair wrapping from the highest token back to the lowest.
    #[napi(ts_return_type = "import('./lib/token').Token[]")]
    pub fn get_ring_tokens<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<Vec<JsInstance<'env, js_constructible_class::Token>>> {
        with_custom_error_sync(|| {
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
