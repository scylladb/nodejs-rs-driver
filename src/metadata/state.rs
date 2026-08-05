use crate::metadata::host::cache_host_map;
use crate::utils::js_ctor::js_constructible_class;
use crate::utils::napi_ref::NapiRef;
use napi::Env;
use napi::bindgen_prelude::Either4;
use scylla::cluster::metadata::Strategy;
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
}

impl ClusterSnapshot {
    pub(crate) fn new(inner: Arc<scylla::cluster::ClusterState>, env: &Env) -> napi::Result<Self> {
        let host_map = cache_host_map(&inner, env)?;
        Ok(ClusterSnapshot { inner, host_map })
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
#[expect(unused)]
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
