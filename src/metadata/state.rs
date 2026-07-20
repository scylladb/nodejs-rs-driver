use crate::errors::ConvertedResult;
use crate::metadata::host::build_known_nodes;
use crate::utils::js_ctor::js_constructible_class;
use crate::utils::napi_ref::NapiRef;
use napi::Env;
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
