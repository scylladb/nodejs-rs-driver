use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error_sync};
use crate::metadata::host::cache_host_map;
use crate::session::SessionWrapper;
use crate::utils::cache::ReferenceCache;
use crate::utils::js_ctor::js_constructible_class;
use crate::utils::napi_ref::NapiRef;
use crate::utils::to_napi_obj::NamedMap;
use napi::Env;
use napi::bindgen_prelude::{Either4, JavaScriptClassExt, Reference};
use scylla::cluster::metadata::{Keyspace, Strategy};
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
            .get_or_init(env, name, || match self.inner.get_keyspace(name) {
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
        self.keyspaces.get_or_init_all(env, || {
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

/// Describes a keyspace in the cluster. Tables and materialized views, and user defined types
/// are populated lazily and cached.
#[napi(js_name = "KeyspaceMetadata")]
pub struct KeyspaceWrapper {
    inner: Keyspace,
}

impl KeyspaceWrapper {
    pub(crate) fn new(inner: Keyspace) -> Self {
        KeyspaceWrapper { inner }
    }
}

/// The variants of a keyspace's replication strategy. Each variant carries only the fields that are
/// meaningful for it. `kind` is declared as a numeric literal type rather than plain `number`, which
/// is what lets TypeScript discriminate the union.
#[napi(object)]
pub struct SimpleStrategy {
    /// `kind` is `StrategyKind.SimpleStrategy`.
    #[napi(ts_type = "0")]
    pub kind: u32,
    /// How many replicas of each piece of data there are.
    pub replication_factor: u32,
}

#[napi(object)]
pub struct NetworkTopologyStrategy {
    /// `kind` is `StrategyKind.NetworkTopologyStrategy`.
    #[napi(ts_type = "1")]
    pub kind: u32,
    /// How many replicas of each piece of data there are in each datacenter, keyed by datacenter name.
    pub datacenter_repfactors: HashMap<String, u32>,
}

#[napi(object)]
pub struct LocalStrategy {
    /// `kind` is `StrategyKind.LocalStrategy`.
    #[napi(ts_type = "2")]
    pub kind: u32,
}

#[napi(object)]
pub struct OtherStrategy {
    /// `kind` is `StrategyKind.Other`.
    #[napi(ts_type = "3")]
    pub kind: u32,
    /// Name of the strategy, as reported by the server.
    pub name: String,
    /// Additional parameters of the strategy, which the driver does not interpret.
    pub data: HashMap<String, String>,
}

/// Converts the Rust driver's `Strategy` into the discriminated union described above.
///
/// Unlike the other metadata conversions, this needs no registered JS constructor: the variants
/// are plain data, so `#[napi(object)]` derives the conversion and guarantees the emitted property
/// names and types match the Rust struct fields.
#[deny(clippy::wildcard_enum_match_arm)]
fn convert_rust_strategy(
    strategy: &Strategy,
) -> Either4<SimpleStrategy, NetworkTopologyStrategy, LocalStrategy, OtherStrategy> {
    match strategy {
        Strategy::SimpleStrategy { replication_factor } => Either4::A(SimpleStrategy {
            kind: 0,
            replication_factor: *replication_factor as u32,
        }),
        Strategy::NetworkTopologyStrategy {
            datacenter_repfactors,
        } => Either4::B(NetworkTopologyStrategy {
            kind: 1,
            datacenter_repfactors: datacenter_repfactors
                .iter()
                .map(|(dc, repfactor)| (dc.clone(), *repfactor as u32))
                .collect(),
        }),
        Strategy::LocalStrategy => Either4::C(LocalStrategy { kind: 2 }),
        Strategy::Other { name, data } => Either4::D(OtherStrategy {
            kind: 3,
            name: name.clone(),
            data: data.clone(),
        }),
        _ => unreachable!(
            "If a new Strategy variant is added, update convert_rust_strategy to handle it."
        ),
    }
}

#[napi]
impl SessionWrapper {
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
    #[napi(ts_return_type = "Record<string, KeyspaceWrapper>")]
    pub fn get_all_keyspaces(
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
    ///
    /// The return type is left to napi-rs to generate from the four `#[napi(object)]` variants,
    /// so the declared union cannot drift from the objects actually produced.
    #[napi(getter)]
    pub fn strategy(
        &self,
    ) -> Either4<SimpleStrategy, NetworkTopologyStrategy, LocalStrategy, OtherStrategy> {
        convert_rust_strategy(&self.inner.strategy)
    }

    /// Whether the keyspace has durable writes enabled.
    #[napi(getter)]
    pub fn durable_writes(&self) -> bool {
        self.inner.durable_writes
    }
}
