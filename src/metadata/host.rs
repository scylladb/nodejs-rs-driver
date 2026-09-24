use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use napi::Env;
use napi::bindgen_prelude::{BigInt, FnArgs};
use scylla::cluster::{ClusterState, Node};
use scylla::routing::Token;

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error_sync};
use crate::metadata::state::{ClusterSnapshot, ReplicaValue};
use crate::session::SessionWrapper;
use crate::types::type_helpers::SocketAddrWrapper;
use crate::utils::bigint_to_i64;
use crate::utils::cache::NapiRefCache;
use crate::utils::js_ctor::{
    HostCtorArgs, build_host, build_host_map, build_socket_address, js_constructible_class,
};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;
use crate::utils::to_napi_obj::{CopyableBuffer, NamedMap};

/// Builds a JS `Host` object for every node known via `cluster_state`, pinning each one in
/// `hosts`, and collects them into a single JS `HostMap`, pinned by the returned `NapiRef`.
///
/// Keeping the individual hosts in a cache of their own is what lets a single node be looked
/// up by id later, without going back through the JS map. Pinning the `HostMap` means
/// `SessionWrapper::get_all_hosts` hands back one already-assembled object instead of rebuilding
/// a map on the JS side per call, for as long as the cluster state doesn't change.
pub(crate) fn cache_hosts(
    cluster_state: &ClusterState,
    env: &Env,
    hosts: &NapiRefCache<js_constructible_class::Host>,
) -> ConvertedResult<NapiRef<js_constructible_class::HostMap>> {
    let entries = hosts.get_or_init_all(env, || {
        cluster_state
            .get_nodes_info()
            .iter()
            .map(|node| {
                let host = build_host(env, host_ctor_args(node, env)?)?;
                let key = node.host_id.simple().to_string();
                Ok((key, host))
            })
            .collect::<ConvertedResult<HashMap<_, _>>>()
    })?;

    let items = NamedMap::new(entries);
    let host_map = build_host_map(env, FnArgs::from((items,)))?;
    NapiRef::new(env, host_map).map_err(ConvertedError::from)
}

/// A live handle to a node of the Rust driver's cluster state.
///
/// Everything else a `Host` exposes is a snapshot: the address, datacenter, rack and host id are
/// copied out of the `Node` when the `Host` is built. Liveness cannot be snapshotted the same
/// way. Holding the `Arc<Node>` lets the value be read afresh on every call.
#[napi]
pub struct NodeHandle {
    inner: Arc<Node>,
}

#[napi]
impl NodeHandle {
    /// Whether the driver currently holds at least one working connection to this node.
    #[napi]
    pub fn is_connected(&self) -> bool {
        self.inner.is_connected()
    }
}

/// Builds the arguments passed to the JS Host constructor for the given node.
fn host_ctor_args<'a>(node: &'a Arc<Node>, env: &'a Env) -> napi::Result<HostCtorArgs<'a>> {
    let address = SocketAddr::new(node.address.ip(), node.address.port());
    let address = build_socket_address(env, FnArgs::from((SocketAddrWrapper::from(address),)))?;

    Ok(FnArgs::from((
        address,
        node.datacenter.as_deref(),
        node.rack.as_deref(),
        CopyableBuffer::new(node.host_id.as_bytes().as_slice()),
        NodeHandle {
            inner: Arc::clone(node),
        },
    )))
}

#[napi]
impl SessionWrapper {
    /// Returns all nodes known by the Rust driver as a `HostMap`, keyed by address, for the
    /// current cluster state (refreshing the cached cluster state snapshot first, if the Rust
    /// driver has produced a newer one since the last access). The same JS `HostMap` object is
    /// returned across calls, for as long as the underlying cluster state doesn't change.
    #[napi(ts_return_type = "import('../lib/host').HostMap")]
    pub fn get_all_hosts<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<JsInstance<'env, js_constructible_class::HostMap>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |cluster_snapshot: &ClusterSnapshot| {
                cluster_snapshot
                    .host_map
                    .get(env)
                    .map_err(ConvertedError::from)
            })
        })
    }

    /// Returns the replicas of the given token of the given table: each the shard of a node the
    /// partition lives on, paired with that node. Throws if the keyspace or the table is not found.
    ///
    /// The hosts are the very same JS objects `get_all_hosts` hands out, so a replica's node can
    /// be compared against a host of the cluster by identity.
    #[napi(ts_return_type = "import('../lib/host').Replica[]")]
    pub fn get_replicas<'env>(
        &self,
        env: &'env Env,
        keyspace: String,
        table: String,
        token: BigInt,
    ) -> JsResult<Vec<JsInstance<'env, ReplicaValue>>> {
        with_custom_error_sync(|| {
            self.with_cluster_snapshot(env, |snapshot| {
                let token = Token::new(bigint_to_i64(token, "Token value must fit in i64")?);
                snapshot.replicas(env, &keyspace, &table, token)
            })
        })
    }
}
