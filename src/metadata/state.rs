use crate::metadata::host::cache_host_map;
use crate::utils::js_ctor::build_strategy;
use crate::utils::js_ctor::js_constructible_class;
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;
use napi::Env;
use napi::bindgen_prelude::FnArgs;
use scylla::cluster::metadata::Strategy;
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
}

impl ClusterSnapshot {
    pub(crate) fn new(inner: Arc<scylla::cluster::ClusterState>, env: &Env) -> napi::Result<Self> {
        let host_map = cache_host_map(&inner, env)?;
        Ok(ClusterSnapshot { inner, host_map })
    }
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
#[expect(unused)]
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
