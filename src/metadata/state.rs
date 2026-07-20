use crate::errors::{ConvertedResult, JsResult, with_custom_error_sync};
use crate::metadata::host::build_known_nodes;
use crate::types::type_wrappers::ComplexType;
use crate::utils::js_ctor::{build_column_metadata, build_table_metadata, js_constructible_class};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;
use napi::Env;
use napi::bindgen_prelude::FnArgs;
use scylla::cluster::metadata::{Column, ColumnKind, Table};
use std::collections::HashMap;
use std::sync::Arc;

/// A snapshot of the cluster's topology and schema metadata, as known by the driver
/// at a given point in time.
///
/// Cluster metadata is refreshed periodically by the Rust driver in the background.
/// Rather than mutating the previous snapshot in place, the driver produces a brand
/// new `Arc<ClusterState>` on every refresh. This lets us cheaply detect whether the
/// snapshot backing a given `ClusterSnapshot` is stale, by comparing Arc pointers.
#[napi]
pub struct ClusterSnapshot {
    pub(crate) inner: Arc<scylla::cluster::ClusterState>,
    /// All nodes known by the Rust driver at the time this snapshot was created, as JS `Host` objects.
    ///
    /// Each `NapiRef` releases the JS object it pins automatically when dropped (i.e. when this
    /// `ClusterSnapshot` itself is dropped, which napi-rs guarantees happens on the JS thread, as
    /// part of finalizing the JS wrapper object this struct backs), so no custom finalizer is
    /// needed here to avoid leaking one JS `Host` object per node on every cluster state refresh.
    pub(crate) known_nodes: Vec<NapiRef<js_constructible_class::Host>>,
}

impl ClusterSnapshot {
    pub(crate) fn new(
        inner: Arc<scylla::cluster::ClusterState>,
        env: Env,
    ) -> ConvertedResult<Self> {
        let known_nodes = build_known_nodes(&inner, env)?;
        Ok(ClusterSnapshot { inner, known_nodes })
    }
}

/// Maps a `ColumnKind` to the numeric discriminant expected by the JS-side enum:
/// `Regular = 0`, `Static = 1`, `ClusteringKey = 2`, `PartitionKey = 3`.
#[deny(clippy::wildcard_enum_match_arm)]
fn column_kind_discriminant(kind: &ColumnKind) -> u32 {
    match kind {
        ColumnKind::Regular => 0,
        ColumnKind::Static => 1,
        ColumnKind::Clustering => 2,
        ColumnKind::PartitionKey => 3,
        _ => unreachable!(
            "If a new ColumnKind variant is added, update column_kind_discriminant to handle it"
        ),
    }
}

/// Converts a Rust driver's column map into the `[name, ColumnMetadata]` pairs shape,
/// by directly constructing a `ColumnMetadata` JS instance for each column.
fn columns_to_metadata(
    env: &Env,
    columns: &HashMap<String, Column>,
) -> napi::Result<
    Vec<(
        String,
        JsInstance<'static, js_constructible_class::ColumnMetadata>,
    )>,
> {
    columns
        .iter()
        .map(|(name, col)| {
            let typ = ComplexType::new_owned(col.typ.clone());
            let kind = column_kind_discriminant(&col.kind);
            let column_metadata = build_column_metadata(env, FnArgs::from((typ, kind)))?;
            Ok((name.clone(), column_metadata))
        })
        .collect()
}

fn convert_rust_table<'env>(
    env: &'env Env,
    table: &Table,
) -> napi::Result<JsInstance<'env, js_constructible_class::TableMetadata>> {
    let columns = columns_to_metadata(env, &table.columns)?;
    build_table_metadata(
        env,
        FnArgs::from((
            columns,
            table.partition_key.clone(),
            table.clustering_key.clone(),
            table.partitioner.clone(),
        )),
    )
}

#[napi]
impl ClusterSnapshot {
    #[napi(ts_return_type = "import('../lib/metadata/table-metadata').TableMetadata | null")]
    pub fn get_table<'env>(
        &self,
        env: &'env Env,
        keyspace: String,
        table: String,
    ) -> JsResult<Option<JsInstance<'env, js_constructible_class::TableMetadata>>> {
        with_custom_error_sync(|| {
            let Some(rust_keyspace) = self.inner.get_keyspace(&keyspace) else {
                return ConvertedResult::Ok(None);
            };
            let Some(rust_table) = rust_keyspace.tables.get(&table) else {
                return ConvertedResult::Ok(None);
            };
            let table_metadata = convert_rust_table(env, rust_table)?;
            ConvertedResult::Ok(Some(table_metadata))
        })
    }
}
