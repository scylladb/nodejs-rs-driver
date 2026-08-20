use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error_sync};
use crate::metadata::host::cache_host_map;
use crate::session::SessionWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::cache::{NapiRefCache, ReferenceCache};
use crate::utils::js_ctor::{
    build_column_metadata, build_materialized_view, build_strategy, build_table_metadata,
    build_udt, build_udt_field, js_constructible_class,
};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;
use crate::utils::to_napi_obj::NamedMap;
use napi::Env;
use napi::bindgen_prelude::{FnArgs, JavaScriptClassExt, Reference};
use scylla::cluster::metadata::{
    Column, ColumnKind, Keyspace, MaterializedView, Strategy, Table, UserDefinedType,
};
use std::collections::HashMap;
use std::sync::Arc;

/// A snapshot of the cluster's topology and schema metadata, as known by the driver
/// at a given point in time.
///
/// Cluster metadata is refreshed periodically by the Rust driver in the background.
/// Rather than mutating the previous snapshot in place, the driver produces a brand
/// new `Arc<ClusterState>` on every refresh. This lets us cheaply detect whether the
/// snapshot backing a given `ClusterSnapshot` is stale, by comparing Arc pointers.
pub(crate) struct ClusterSnapshot {
    pub(crate) inner: Arc<scylla::cluster::ClusterState>,
    /// All nodes known by the Rust driver at the time this snapshot was created, as a JS `HostMap`
    /// of `Host` objects keyed by address.
    ///
    /// The `NapiRef` releases the JS object it pins automatically when dropped (i.e. when this
    /// `ClusterSnapshot` itself is dropped, or replaced by a fresher one), so no custom finalizer
    /// is needed here to avoid leaking a `HostMap` on every cluster state refresh. Pinning the map
    /// keeps every `Host` it holds alive, so the hosts need no separate `NapiRef`s.
    pub(crate) host_map: NapiRef<js_constructible_class::HostMap>,
    /// Keyspaces of this snapshot, populated lazily.
    pub(crate) keyspaces: ReferenceCache<KeyspaceWrapper>,
}

impl ClusterSnapshot {
    pub(crate) fn new(inner: Arc<scylla::cluster::ClusterState>, env: &Env) -> napi::Result<Self> {
        let host_map = cache_host_map(&inner, env)?;
        Ok(ClusterSnapshot {
            inner,
            host_map,
            keyspaces: ReferenceCache::new(),
        })
    }

    /// Returns the cached `KeyspaceWrapper` reference for `name`, converting and caching it lazily
    /// if this is the first lookup for that name in this snapshot. Returns `None` if no such
    /// keyspace exists in the Rust driver's cluster state.
    pub(crate) fn keyspace_wrapper(
        &self,
        env: &Env,
        name: &str,
    ) -> ConvertedResult<Option<Reference<KeyspaceWrapper>>> {
        self.keyspaces
            .get_or_init(*env, name, || match self.inner.get_keyspace(name) {
                Some(keyspace) => {
                    let wrapper = KeyspaceWrapper::new(keyspace.clone());
                    ConvertedResult::Ok(Some(
                        wrapper.into_reference(*env).map_err(ConvertedError::from)?,
                    ))
                }
                None => ConvertedResult::Ok(None),
            })
    }

    /// Returns a `KeyspaceWrapper` reference for every keyspace in this snapshot, keyed by name,
    /// converting and caching each lazily the first time it is accessed. After first `get_or_init_all`
    /// access, the complete flag is set, so subsequent calls do not need to convert the keyspaces again.
    pub(crate) fn all_keyspace_wrappers(
        &self,
        env: &Env,
    ) -> ConvertedResult<HashMap<String, Reference<KeyspaceWrapper>>> {
        self.keyspaces.get_or_init_all(*env, || {
            self.inner
                .keyspaces_iter()
                .map(|(name, keyspace)| {
                    let wrapper = KeyspaceWrapper::new(keyspace.clone());
                    let reference = wrapper.into_reference(*env).map_err(ConvertedError::from)?;
                    ConvertedResult::Ok((name.to_owned(), reference))
                })
                .collect::<ConvertedResult<HashMap<_, _>>>()
        })
    }
}

/// Describes a keyspace in the cluster. Mirrors the Python driver's `Keyspace`.
/// Tables and materialized views, and user defined types are populated lazily and cached.
#[napi]
pub struct KeyspaceWrapper {
    inner: Keyspace,
    tables: NapiRefCache<js_constructible_class::TableMetadata>,
    views: NapiRefCache<js_constructible_class::MaterializedView>,
    udts: NapiRefCache<js_constructible_class::Udt>,
}

impl KeyspaceWrapper {
    pub(crate) fn new(inner: Keyspace) -> Self {
        KeyspaceWrapper {
            inner,
            tables: NapiRefCache::new(),
            views: NapiRefCache::new(),
            udts: NapiRefCache::new(),
        }
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

/// Converts a Rust driver's column map into an already-built `Record<string, ColumnMetadata>`,
/// by directly constructing a `ColumnMetadata` JS instance for each column.
fn columns_to_metadata<'a>(
    env: &'a Env,
    columns: &'a HashMap<String, Column>,
) -> napi::Result<NamedMap<&'a str, JsInstance<'a, js_constructible_class::ColumnMetadata>>> {
    columns
        .iter()
        .map(|(name, col)| {
            let typ = ComplexType::new_borrowed(&col.typ);
            let kind = column_kind_discriminant(&col.kind);
            let column_metadata = build_column_metadata(env, FnArgs::from((typ, kind)))?;
            Ok((name.as_str(), column_metadata))
        })
        .collect::<napi::Result<HashMap<_, _>>>()
        .map(NamedMap::new)
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
            &table.partition_key,
            &table.clustering_key,
            table.partitioner.as_deref(),
        )),
    )
}

fn convert_rust_materialized_view<'env>(
    env: &'env Env,
    view: &MaterializedView,
) -> napi::Result<JsInstance<'env, js_constructible_class::MaterializedView>> {
    let columns = columns_to_metadata(env, &view.view_metadata.columns)?;
    build_materialized_view(
        env,
        FnArgs::from((
            columns,
            &view.view_metadata.partition_key,
            &view.view_metadata.clustering_key,
            view.view_metadata.partitioner.as_deref(),
            view.base_table_name.as_str(),
        )),
    )
}

fn convert_rust_udt<'env>(
    env: &'env Env,
    udt: &UserDefinedType<'static>,
) -> napi::Result<JsInstance<'env, js_constructible_class::Udt>> {
    let fields = udt
        .field_types
        .iter()
        .map(|(field_name, field_type)| {
            let typ = ComplexType::new_borrowed(field_type);
            build_udt_field(env, FnArgs::from((field_name.as_ref(), typ)))
        })
        .collect::<napi::Result<Vec<_>>>()?;
    build_udt(
        env,
        FnArgs::from((udt.name.as_ref(), udt.keyspace.as_ref(), fields)),
    )
}

/// Maps a `Strategy` to the numeric discriminant expected by the JS `StrategyKind`
/// enum: `SimpleStrategy = 0`, `NetworkTopologyStrategy = 1`, `LocalStrategy = 2`, `Other = 3`.
#[deny(clippy::wildcard_enum_match_arm)]
fn strategy_kind_discriminant(strategy: &Strategy) -> u32 {
    match strategy {
        Strategy::SimpleStrategy { .. } => 0,
        Strategy::NetworkTopologyStrategy { .. } => 1,
        Strategy::LocalStrategy => 2,
        Strategy::Other { .. } => 3,
        _ => unreachable!(
            "If a new Strategy variant is added, update strategy_kind_discriminant to handle it."
        ),
    }
}

/// Converts a Rust driver's `Strategy` into a JS instance. Only the field(s) relevant
/// to the strategy's kind are populated; the rest are left `null` by the JS constructor.
#[deny(clippy::wildcard_enum_match_arm)]
fn convert_rust_strategy<'env>(
    env: &'env Env,
    strategy: &Strategy,
) -> napi::Result<JsInstance<'env, js_constructible_class::Strategy>> {
    let kind = strategy_kind_discriminant(strategy);
    let (replication_factor, datacenter_repfactors, name, data) = match strategy {
        Strategy::SimpleStrategy { replication_factor } => {
            (Some(*replication_factor as u32), None, None, None)
        }
        Strategy::NetworkTopologyStrategy {
            datacenter_repfactors,
        } => {
            let repfactors = datacenter_repfactors
                .iter()
                .map(|(dc, repfactor)| (dc.as_str(), *repfactor as u32))
                .collect();
            (None, Some(repfactors), None, None)
        }
        Strategy::LocalStrategy => (None, None, None, None),
        Strategy::Other { name, data } => {
            let data = data.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            (None, None, Some(name.as_str()), Some(data))
        }
        _ => unreachable!(
            "If a new Strategy variant is added, update convert_rust_strategy to handle it."
        ),
    };
    build_strategy(
        env,
        FnArgs::from((kind, replication_factor, datacenter_repfactors, name, data)),
    )
}

#[napi]
impl SessionWrapper {
    /// Gets the definition of a table.
    ///
    /// The table is converted lazily and cached against its keyspace: repeated lookups for the
    /// same table, whether through this method or through `KeyspaceWrapper::tables`, return the
    /// same JS object.
    #[napi(ts_return_type = "import('../lib/metadata/table-metadata').TableMetadata | null")]
    pub fn get_table<'env>(
        &self,
        env: &'env Env,
        keyspace: String,
        table: String,
    ) -> JsResult<Option<JsInstance<'env, js_constructible_class::TableMetadata>>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot| {
                let Some(ks) = snapshot.keyspace_wrapper(env, &keyspace)? else {
                    return ConvertedResult::Ok(None);
                };
                ks.tables.get_or_init(env, &table, || {
                    let Some(rust_table) = ks.inner.tables.get(&table) else {
                        return ConvertedResult::Ok(None);
                    };
                    ConvertedResult::Ok(Some(convert_rust_table(env, rust_table)?))
                })
            })
        })
    }

    /// Gets the definition of a CQL materialized view for a given name.
    ///
    /// The view is converted lazily and cached against its keyspace: repeated lookups for the
    /// same view, whether through this method or through `KeyspaceWrapper::views`, return the
    /// same JS object.
    #[napi(ts_return_type = "import('../lib/metadata/materialized-view').MaterializedView | null")]
    pub fn get_materialized_view<'env>(
        &self,
        env: &'env Env,
        keyspace: String,
        view: String,
    ) -> JsResult<Option<JsInstance<'env, js_constructible_class::MaterializedView>>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot| {
                let Some(ks) = snapshot.keyspace_wrapper(env, &keyspace)? else {
                    return ConvertedResult::Ok(None);
                };
                ks.views.get_or_init(env, &view, || {
                    let Some(rust_view) = ks.inner.views.get(&view) else {
                        return ConvertedResult::Ok(None);
                    };
                    ConvertedResult::Ok(Some(convert_rust_materialized_view(env, rust_view)?))
                })
            })
        })
    }

    /// Gets the definition of an user-defined type.
    ///
    /// The UDT is converted lazily and cached against its keyspace: repeated lookups for the
    /// same UDT, whether through this method or through `KeyspaceWrapper::udts`,
    /// return the same JS object.
    #[napi(ts_return_type = "import('../lib/metadata/user-defined-type').Udt | null")]
    pub fn get_udt<'env>(
        &self,
        env: &'env Env,
        keyspace: String,
        name: String,
    ) -> JsResult<Option<JsInstance<'env, js_constructible_class::Udt>>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot| {
                let Some(ks) = snapshot.keyspace_wrapper(env, &keyspace)? else {
                    return ConvertedResult::Ok(None);
                };
                ks.udts.get_or_init(env, &name, || {
                    let Some(rust_udt) = ks.inner.user_defined_types.get(&name) else {
                        return ConvertedResult::Ok(None);
                    };
                    ConvertedResult::Ok(Some(convert_rust_udt(env, rust_udt)?))
                })
            })
        })
    }

    /// Returns metadata about the keyspace with the given name, or `null` if it does not exist.
    ///
    /// The keyspace is converted lazily and cached: repeated lookups for the same name
    /// return the same JS object.
    #[napi(ts_return_type = "KeyspaceWrapper | null")]
    pub fn get_keyspace_wrapper(
        &self,
        env: &Env,
        name: String,
    ) -> JsResult<Option<Reference<KeyspaceWrapper>>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot: &ClusterSnapshot| {
                snapshot.keyspace_wrapper(env, &name)
            })
        })
    }

    /// Returns metadata about every keyspace in the cluster, keyed by name.
    ///
    /// Keyspaces are converted lazily and cached: repeated lookups for the same keyspace,
    /// whether through this method or through `get_keyspace_wrapper`, return the same JS object.
    #[napi(ts_return_type = "Record<string, KeyspaceWrapper>")]
    pub fn get_keyspace_wrappers(
        &self,
        env: &Env,
    ) -> JsResult<NamedMap<String, Reference<KeyspaceWrapper>>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot: &ClusterSnapshot| {
                let keyspaces = snapshot.all_keyspace_wrappers(env)?;
                ConvertedResult::Ok(NamedMap::new(keyspaces))
            })
        })
    }
}

#[napi]
impl KeyspaceWrapper {
    /// Replication strategy used by the keyspace.
    #[napi(
        getter,
        ts_return_type = "import('../lib/metadata/keyspace-metadata').Strategy"
    )]
    pub fn strategy<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<JsInstance<'env, js_constructible_class::Strategy>> {
        with_custom_error_sync(|| {
            let strategy = convert_rust_strategy(env, &self.inner.strategy)?;
            ConvertedResult::Ok(strategy)
        })
    }

    /// Whether the keyspace has durable writes enabled.
    #[napi(getter)]
    pub fn durable_writes(&self) -> bool {
        self.inner.durable_writes
    }

    /// Tables in the keyspace, keyed by table name.
    #[napi(
        getter,
        ts_return_type = "Record<string, import('../lib/metadata/table-metadata').TableMetadata>"
    )]
    pub fn tables<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<NamedMap<String, JsInstance<'env, js_constructible_class::TableMetadata>>> {
        with_custom_error_sync(|| {
            let tables = self.tables.get_or_init_all(env, || {
                self.inner
                    .tables
                    .iter()
                    .map(|(name, table)| Ok((name.clone(), convert_rust_table(env, table)?)))
                    .collect::<ConvertedResult<
                        HashMap<String, JsInstance<'env, js_constructible_class::TableMetadata>>,
                    >>()
            })?;
            ConvertedResult::Ok(NamedMap::new(tables.into_iter().collect()))
        })
    }

    /// Materialized views in the keyspace, keyed by view name.
    #[napi(
        getter,
        ts_return_type = "Record<string, import('../lib/metadata/materialized-view').MaterializedView>"
    )]
    pub fn views<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<NamedMap<String, JsInstance<'env, js_constructible_class::MaterializedView>>>
    {
        with_custom_error_sync(|| {
            let views = self.views.get_or_init_all(env, || {
                self.inner
                    .views
                    .iter()
                    .map(|(name, view)| {
                        Ok((name.clone(), convert_rust_materialized_view(env, view)?))
                    })
                    .collect::<ConvertedResult<
                        HashMap<String, JsInstance<'env, js_constructible_class::MaterializedView>>,
                    >>()
            })?;
            ConvertedResult::Ok(NamedMap::new(views.into_iter().collect()))
        })
    }

    /// User-defined types in the keyspace, keyed by type name.
    #[napi(
        getter,
        ts_return_type = "Record<string, import('../lib/metadata/user-defined-type').Udt>"
    )]
    pub fn udts<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<NamedMap<String, JsInstance<'env, js_constructible_class::Udt>>> {
        with_custom_error_sync(|| {
            let udts = self.udts.get_or_init_all(env, || {
                self.inner
                    .user_defined_types
                    .iter()
                    .map(|(name, udt)| Ok((name.clone(), convert_rust_udt(env, udt)?)))
                    .collect::<ConvertedResult<
                        HashMap<String, JsInstance<'env, js_constructible_class::Udt>>,
                    >>()
            })?;
            ConvertedResult::Ok(NamedMap::new(udts.into_iter().collect()))
        })
    }
}
