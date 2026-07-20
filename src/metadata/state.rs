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
}

impl ClusterSnapshot {
    pub(crate) fn new(
        inner: Arc<scylla::cluster::ClusterState>,
    ) -> Self {
        ClusterSnapshot { inner }
    }
}
