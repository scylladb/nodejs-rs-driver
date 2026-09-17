use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_sync,
};
use crate::metadata::host::cache_hosts;
use crate::session::SessionWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::cache::{NapiRefCache, ReferenceCache, SingleNapiRefCache};
use crate::utils::js_ctor::{
    build_column_metadata, build_local_strategy, build_materialized_view,
    build_network_topology_strategy, build_other_strategy, build_simple_strategy,
    build_table_metadata, build_udt, build_udt_field, js_constructible_class,
};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;
use crate::utils::to_napi_obj::NamedMap;
use napi::Env;
use napi::bindgen_prelude::{FnArgs, JavaScriptClassExt, JsObjectValue, Object, Reference};
use scylla::cluster::metadata::{
    Column, ColumnKind, Keyspace, MaterializedView, Strategy, Table, UserDefinedType,
};
use scylla::routing::{Shard, Token};
use std::collections::HashMap;
use std::sync::Arc;

/// Tags the `Record<string, KeyspaceMetadata>` handed to JS by `getAllKeyspaces`.
pub enum KeyspaceRecord {}

/// Tags the object handed to JS by `KeyspaceMetadata#strategy`.
pub enum StrategyValue {}

/// Tags the `Record<string, TableMetadata>` handed to JS by `KeyspaceMetadata#tables`.
pub enum TableRecord {}

/// Tags the `Record<string, MaterializedView>` handed to JS by `KeyspaceMetadata#views`.
pub enum ViewRecord {}

/// Tags the `Record<string, Udt>` handed to JS by `KeyspaceMetadata#udts`.
pub enum UdtRecord {}

/// Tags the `{ host, shard }` object handed to JS by `getReplicas`.
pub enum ReplicaValue {}

/// Builds the `{ host, shard }` object describing one replica of a partition.
fn build_replica<'env>(
    env: &'env Env,
    host: JsInstance<'env, js_constructible_class::Host>,
    shard: Shard,
) -> napi::Result<JsInstance<'env, ReplicaValue>> {
    let mut replica = Object::new(env)?;
    replica.set_named_property("host", host)?;
    replica.set_named_property("shard", shard)?;
    Ok(JsInstance::from_object(replica))
}

/// A snapshot of the cluster's topology and schema metadata, as known by the driver
/// at a given point in time.
///
/// Cluster metadata is refreshed periodically by the Rust driver in the background.
/// Rather than mutating the previous snapshot in place, the driver produces a brand
/// new `Arc<ClusterState>` on every refresh. This lets us cheaply detect whether the
/// snapshot backing a given `ClusterSnapshot` is stale, by comparing Arc pointers.
pub(crate) struct ClusterSnapshot {
    pub(crate) inner: Arc<scylla::cluster::ClusterState>,
    /// All nodes known by the Rust driver at the time this snapshot was created, as JS `Host`
    /// objects keyed by the hex-encoded bytes of their host id. Filled in full when the snapshot
    /// is created.
    hosts: NapiRefCache<js_constructible_class::Host>,
    /// The same nodes, collected into the single JS `HostMap` handed to JS as `client.hosts`.
    ///
    /// The `NapiRef`s release the JS objects they pin automatically when dropped (i.e. when this
    /// `ClusterSnapshot` itself is dropped, or replaced by a fresher one), so no custom finalizer
    /// is needed here to avoid leaking a `HostMap` and its hosts on every cluster state refresh.
    pub(crate) host_map: NapiRef<js_constructible_class::HostMap>,
    /// Cache of keyspaces of this snapshot, populated lazily.
    keyspace_cache: ReferenceCache<KeyspaceWrapper>,
    /// The record of every keyspace, as handed to JS, built on first use.
    keyspaces_record: SingleNapiRefCache<KeyspaceRecord>,
}

impl ClusterSnapshot {
    pub(crate) fn new(
        inner: Arc<scylla::cluster::ClusterState>,
        env: &Env,
    ) -> ConvertedResult<Self> {
        let hosts = NapiRefCache::new();
        let host_map = cache_hosts(&inner, env, &hosts)?;
        Ok(ClusterSnapshot {
            inner,
            hosts,
            host_map,
            keyspace_cache: ReferenceCache::new(),
            keyspaces_record: SingleNapiRefCache::new(),
        })
    }

    /// The replicas of `token` of the given table: each the shard of a node the partition lives
    /// on, paired with the very same JS `Host` object this snapshot's `HostMap` holds.
    ///
    /// If passed keyspace is unknown, this falls back to Strategy::SimpleStrategy with
    /// replication_factor = 1, walks the global ring from token and returns the first node it finds.
    ///
    /// If keyspace exists and uses tablets, but the table doesn't exist, this uses keyspace's real
    /// replication strategy over the vnode ring (tablets aren't considered since they can't be
    /// looked up).
    ///
    /// TODO: update this comment when Rust Driver is fixed – https://github.com/scylladb/scylla-rust-driver/issues/1908.
    pub(crate) fn replicas<'env>(
        &self,
        env: &'env Env,
        keyspace: &str,
        table: &str,
        token: Token,
    ) -> ConvertedResult<Vec<JsInstance<'env, ReplicaValue>>> {
        self.inner
            .get_token_endpoints(keyspace, table, token)
            .into_iter()
            .map(|(node, shard)| {
                let host = self
                    .hosts
                    .get_or_init(env, &node.host_id.simple().to_string(), || {
                        ConvertedResult::Ok(None)
                    })?.ok_or_else(|| {
                        ConvertedError::from(make_js_error(format!(
                            "Node {} replicates {token:?} but is not part of the cluster state it was read from",
                            node.host_id
                        )))
                    })?;
                build_replica(env, host, shard).map_err(ConvertedError::from)
            })
            .collect::<ConvertedResult<Vec<_>>>()
    }

    /// Returns the cached `KeyspaceWrapper` reference for `name`, converting and caching it lazily
    /// if this is the first lookup for that name in this snapshot. Returns `None` if no such
    /// keyspace exists in the Rust driver's cluster state.
    fn keyspace_wrapper(
        &self,
        env: &Env,
        name: &str,
    ) -> ConvertedResult<Option<Reference<KeyspaceWrapper>>> {
        self.keyspace_cache
            .get_or_init(env, name, || match self.inner.get_keyspace(name) {
                Some(_) => {
                    let wrapper = KeyspaceWrapper::new(Arc::clone(&self.inner), name.to_owned());
                    ConvertedResult::Ok(Some(
                        wrapper.into_reference(*env).map_err(ConvertedError::from)?,
                    ))
                }
                None => ConvertedResult::Ok(None),
            })
    }

    /// Returns the record of every keyspace in this snapshot, keyed by name, building and pinning
    /// it on the first call.
    fn all_keyspaces_record<'env>(
        &self,
        env: &'env Env,
    ) -> ConvertedResult<JsInstance<'env, KeyspaceRecord>> {
        self.keyspaces_record.get_or_init(env, || {
            let wrappers = self.keyspace_cache.get_or_init_all(env, || {
                self.inner
                    .keyspaces_iter()
                    .map(|(name, _keyspace)| {
                        let wrapper =
                            KeyspaceWrapper::new(Arc::clone(&self.inner), name.to_owned());
                        let reference =
                            wrapper.into_reference(*env).map_err(ConvertedError::from)?;
                        ConvertedResult::Ok((name.to_owned(), reference))
                    })
                    .collect::<ConvertedResult<HashMap<_, _>>>()
            })?;
            let record: NamedMap<String, Reference<KeyspaceWrapper>> = NamedMap::new(wrappers);
            record.into_jsinstance(env).map_err(ConvertedError::from)
        })
    }
}

/// Describes a keyspace in the cluster. Tables and materialized views, and user defined types
/// are populated lazily and cached.
#[napi(js_name = "KeyspaceMetadata")]
pub struct KeyspaceWrapper {
    /// The cluster state this keyspace was looked up in.
    ///
    /// Holding the `Arc` rather than a cloned `Keyspace` avoids deep-copying every table, view and
    /// user defined type of the keyspace on each lookup, and pins the exact snapshot the wrapper
    /// was built from: the metadata it reports stays the one it was created with, even after the
    /// driver refreshes its cluster state.
    cluster_state: Arc<scylla::cluster::ClusterState>,
    /// Name of the keyspace within `cluster_state`.
    name: String,
    /// The keyspace's replication strategy, as handed to JS, built on first use.
    strategy_value: SingleNapiRefCache<StrategyValue>,
    /// Caches of three collections, populated lazily
    tables: NapiRefCache<js_constructible_class::TableMetadata>,
    views: NapiRefCache<js_constructible_class::MaterializedView>,
    udts: NapiRefCache<js_constructible_class::Udt>,
    /// The records of the three collections above, as handed to JS, each built on first use.
    tables_record: SingleNapiRefCache<TableRecord>,
    views_record: SingleNapiRefCache<ViewRecord>,
    udts_record: SingleNapiRefCache<UdtRecord>,
}

impl KeyspaceWrapper {
    pub(crate) fn new(cluster_state: Arc<scylla::cluster::ClusterState>, name: String) -> Self {
        KeyspaceWrapper {
            cluster_state,
            name,
            strategy_value: SingleNapiRefCache::new(),
            tables: NapiRefCache::new(),
            views: NapiRefCache::new(),
            udts: NapiRefCache::new(),
            tables_record: SingleNapiRefCache::new(),
            views_record: SingleNapiRefCache::new(),
            udts_record: SingleNapiRefCache::new(),
        }
    }

    /// The keyspace this wrapper describes.
    ///
    /// Infallible in practice: the keyspace was present when the wrapper was built, and the `Arc`
    /// keeps that cluster state alive unchanged for as long as the wrapper lives, so it cannot
    /// disappear from under us.
    fn keyspace(&self) -> &Keyspace {
        self.cluster_state
            .get_keyspace(&self.name)
            .expect("the keyspace was present when this wrapper was built, and the pinned cluster state cannot change")
    }
}

impl KeyspaceWrapper {
    /// Looks up one table by name, converting and caching it lazily.
    fn cached_table<'env>(
        &self,
        env: &'env Env,
        name: &str,
    ) -> ConvertedResult<Option<JsInstance<'env, js_constructible_class::TableMetadata>>> {
        self.tables.get_or_init(env, name, || {
            let table = self
                .keyspace()
                .tables
                .get(name)
                .map(|table| convert_rust_table(env, table))
                .transpose()?;
            ConvertedResult::Ok(table)
        })
    }

    /// Looks up one materialized view by name.
    fn cached_view<'env>(
        &self,
        env: &'env Env,
        name: &str,
    ) -> ConvertedResult<Option<JsInstance<'env, js_constructible_class::MaterializedView>>> {
        self.views.get_or_init(env, name, || {
            let view = self
                .keyspace()
                .views
                .get(name)
                .map(|view| convert_rust_materialized_view(env, view))
                .transpose()?;
            ConvertedResult::Ok(view)
        })
    }

    /// Looks up one user-defined type by name.
    fn cached_udt<'env>(
        &self,
        env: &'env Env,
        name: &str,
    ) -> ConvertedResult<Option<JsInstance<'env, js_constructible_class::Udt>>> {
        self.udts.get_or_init(env, name, || {
            let udt = self
                .keyspace()
                .user_defined_types
                .get(name)
                .map(|udt| convert_rust_udt(env, udt))
                .transpose()?;
            ConvertedResult::Ok(udt)
        })
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

/// Converts the Rust driver's `Strategy` into one of the four JS classes declared in
/// `lib/metadata/strategy.ts`, by calling that class's registered constructor. The declared
/// union is not derived from the Rust types, so the two are kept in step by the constructor
/// signatures alone: changing a field here without changing `strategy.ts` is a runtime mismatch,
/// not a compile error.
#[deny(clippy::wildcard_enum_match_arm)]
fn convert_rust_strategy<'env>(
    env: &'env Env,
    strategy: &Strategy,
) -> napi::Result<JsInstance<'env, StrategyValue>> {
    let instance = match strategy {
        Strategy::SimpleStrategy { replication_factor } => {
            build_simple_strategy(env, FnArgs::from(((*replication_factor as u32),)))?.into_object()
        }
        Strategy::NetworkTopologyStrategy {
            datacenter_repfactors,
        } => {
            let repfactors = datacenter_repfactors
                .iter()
                .map(|(datacenter, repfactor)| (datacenter.as_str(), *repfactor as u32))
                .collect();
            build_network_topology_strategy(env, FnArgs::from((NamedMap::new(repfactors),)))?
                .into_object()
        }
        Strategy::LocalStrategy => build_local_strategy(env, ())?.into_object(),
        Strategy::Other { name, data } => {
            let data = data
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str()))
                .collect();
            build_other_strategy(env, FnArgs::from((name.as_str(), NamedMap::new(data))))?
                .into_object()
        }
        _ => unreachable!(
            "If a new Strategy variant is added, update convert_rust_strategy to handle it."
        ),
    };
    Ok(JsInstance::from_object(instance))
}

#[napi]
impl SessionWrapper {
    /// Gets the definition of a table.
    ///
    /// The table is converted lazily and cached against its keyspace: repeated lookups for the
    /// same table, whether through this method or through `KeyspaceWrapper::tables`, return the
    /// same JS object.
    #[napi(ts_return_type = "import('./lib/metadata/table-metadata').TableMetadata | null")]
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
                ks.cached_table(env, &table)
            })
        })
    }

    /// Gets the definition of a CQL materialized view for a given name.
    ///
    /// The view is converted lazily and cached against its keyspace: repeated lookups for the
    /// same view, whether through this method or through `KeyspaceWrapper::views`, return the
    /// same JS object.
    #[napi(ts_return_type = "import('./lib/metadata/materialized-view').MaterializedView | null")]
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
                ks.cached_view(env, &view)
            })
        })
    }

    /// Gets the definition of an user-defined type.
    ///
    /// The UDT is converted lazily and cached against its keyspace: repeated lookups for the
    /// same UDT, whether through this method or through `KeyspaceWrapper::udts`,
    /// return the same JS object.
    #[napi(ts_return_type = "import('./lib/metadata/user-defined-type').Udt | null")]
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
                ks.cached_udt(env, &name)
            })
        })
    }

    /// Returns metadata about the keyspace with the given name, or `null` if it does not exist.
    ///
    /// The keyspace is converted lazily and cached: repeated lookups for the same name
    /// return the same JS object.
    #[napi(ts_return_type = "KeyspaceWrapper | null")]
    pub fn get_keyspace_metadata(
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
    /// whether through this method or through `get_keyspace_metadata`, return the same JS object.
    #[napi(ts_return_type = "Readonly<Record<string, KeyspaceWrapper>>")]
    pub fn get_all_keyspaces<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<JsInstance<'env, KeyspaceRecord>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot: &ClusterSnapshot| {
                snapshot.all_keyspaces_record(env)
            })
        })
    }
}

/// **Public JS API**: this is the object users get from `Metadata#getKeyspace`, exposed as
/// `KeyspaceMetadata`, so every getter and method below is part of the driver's public surface.
#[napi]
impl KeyspaceWrapper {
    /// Replication strategy used by the keyspace.
    ///
    /// One of the four classes declared in `lib/metadata/strategy.ts`, constructed through that
    /// class's registered constructor; the union they form is declared there rather than derived
    /// from Rust, so it is named here explicitly.
    #[napi(getter, ts_return_type = "import('./lib/metadata/strategy').Strategy")]
    pub fn strategy<'env>(&self, env: &'env Env) -> JsResult<JsInstance<'env, StrategyValue>> {
        with_custom_error_sync(|| {
            self.strategy_value.get_or_init(env, || {
                convert_rust_strategy(env, &self.keyspace().strategy).map_err(ConvertedError::from)
            })
        })
    }

    /// Whether the keyspace has durable writes enabled.
    #[napi(getter)]
    pub fn durable_writes(&self) -> bool {
        self.keyspace().durable_writes
    }

    /// Gets a single table of the keyspace by name.
    #[napi(ts_return_type = "import('./lib/metadata/table-metadata').TableMetadata | null")]
    pub fn get_table<'env>(
        &self,
        env: &'env Env,
        name: String,
    ) -> JsResult<Option<JsInstance<'env, js_constructible_class::TableMetadata>>> {
        with_custom_error_sync(|| {
            let table = self.cached_table(env, name.as_str())?;
            ConvertedResult::Ok(table)
        })
    }

    /// Tables in the keyspace, keyed by table name.
    #[napi(
        getter,
        ts_return_type = "Readonly<Record<string, import('./lib/metadata/table-metadata').TableMetadata>>"
    )]
    pub fn tables<'env>(&self, env: &'env Env) -> JsResult<JsInstance<'env, TableRecord>> {
        with_custom_error_sync(|| {
            self.tables_record.get_or_init(env, || {
                let tables = self.tables.get_or_init_all(env, || {
                    self.keyspace()
                        .tables
                        .iter()
                        .map(|(name, table)| Ok((name.clone(), convert_rust_table(env, table)?)))
                        .collect::<ConvertedResult<
                            HashMap<
                                String,
                                JsInstance<'env, js_constructible_class::TableMetadata>,
                            >,
                        >>()
                })?;
                let record: NamedMap<
                    String,
                    JsInstance<'env, js_constructible_class::TableMetadata>,
                > = NamedMap::new(tables);
                record.into_jsinstance(env).map_err(ConvertedError::from)
            })
        })
    }

    /// Gets a single materialized view of the keyspace by name.
    #[napi(ts_return_type = "import('./lib/metadata/materialized-view').MaterializedView | null")]
    pub fn get_materialized_view<'env>(
        &self,
        env: &'env Env,
        name: String,
    ) -> JsResult<Option<JsInstance<'env, js_constructible_class::MaterializedView>>> {
        with_custom_error_sync(|| {
            let view = self.cached_view(env, name.as_str())?;
            ConvertedResult::Ok(view)
        })
    }

    /// Materialized views in the keyspace, keyed by view name.
    #[napi(
        getter,
        ts_return_type = "Readonly<Record<string, import('./lib/metadata/materialized-view').MaterializedView>>"
    )]
    pub fn views<'env>(&self, env: &'env Env) -> JsResult<JsInstance<'env, ViewRecord>> {
        with_custom_error_sync(|| {
            self.views_record.get_or_init(env, || {
                let views = self.views.get_or_init_all(env, || {
                    self.keyspace()
                        .views
                        .iter()
                        .map(|(name, view)| {
                            Ok((name.clone(), convert_rust_materialized_view(env, view)?))
                        })
                        .collect::<ConvertedResult<
                            HashMap<
                                String,
                                JsInstance<'env, js_constructible_class::MaterializedView>,
                            >,
                        >>()
                })?;
                let record: NamedMap<
                    String,
                    JsInstance<'env, js_constructible_class::MaterializedView>,
                > = NamedMap::new(views);
                record.into_jsinstance(env).map_err(ConvertedError::from)
            })
        })
    }

    /// Gets a single user-defined type of the keyspace by name.
    #[napi(ts_return_type = "import('./lib/metadata/user-defined-type').Udt | null")]
    pub fn get_udt<'env>(
        &self,
        env: &'env Env,
        name: String,
    ) -> JsResult<Option<JsInstance<'env, js_constructible_class::Udt>>> {
        with_custom_error_sync(|| {
            let udt = self.cached_udt(env, name.as_str())?;
            ConvertedResult::Ok(udt)
        })
    }

    /// User-defined types in the keyspace, keyed by type name.
    #[napi(
        getter,
        ts_return_type = "Readonly<Record<string, import('./lib/metadata/user-defined-type').Udt>>"
    )]
    pub fn udts<'env>(&self, env: &'env Env) -> JsResult<JsInstance<'env, UdtRecord>> {
        with_custom_error_sync(|| {
            self.udts_record.get_or_init(env, || {
                let udts = self.udts.get_or_init_all(env, || {
                    self.keyspace()
                        .user_defined_types
                        .iter()
                        .map(|(name, udt)| Ok((name.clone(), convert_rust_udt(env, udt)?)))
                        .collect::<ConvertedResult<
                            HashMap<String, JsInstance<'env, js_constructible_class::Udt>>,
                        >>()
                })?;
                let record: NamedMap<String, JsInstance<'env, js_constructible_class::Udt>> =
                    NamedMap::new(udts);
                record.into_jsinstance(env).map_err(ConvertedError::from)
            })
        })
    }
}
