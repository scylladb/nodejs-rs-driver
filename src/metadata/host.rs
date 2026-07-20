use std::sync::Arc;

use napi::Env;
use napi::bindgen_prelude::{Buffer, FnArgs};
use scylla::cluster::{ClusterState, Node};

use crate::errors::{ConvertedResult, JsResult, with_custom_error_sync};
use crate::session::SessionWrapper;
use crate::utils::js_ctor::{build_host, js_constructible_class};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;

pub(crate) fn build_known_nodes(
    cluster_snapshot: &ClusterState,
    env: Env,
) -> Result<Vec<NapiRef<js_constructible_class::Host>>, napi::Error> {
    cluster_snapshot
        .get_nodes_info()
        .iter()
        .map(|node| {
            let host_obj = build_host(&env, host_ctor_args(node))?;
            NapiRef::new(&env, host_obj)
        })
        .collect()
}

/// Builds the arguments passed to the JS Host constructor for the given node.
fn host_ctor_args(node: &Arc<Node>) -> FnArgs<(String, Option<String>, Option<String>, Buffer)> {
    FnArgs::from((
        node.address.to_string(),
        node.datacenter.clone(),
        node.rack.clone(),
        Buffer::from(node.host_id.as_bytes().as_slice()),
    ))
}

#[napi]
impl SessionWrapper {
    #[napi(ts_return_type = "Array<import('../lib/host').Host>")]
    pub fn get_all_hosts<'env>(
        &self,
        env: &'env Env,
    ) -> JsResult<Vec<JsInstance<'env, js_constructible_class::Host>>> {
        with_custom_error_sync(|| {
            let cluster_snapshot = self.get_or_create_cluster_snapshot(*env)?;
            let hosts = cluster_snapshot
                .known_nodes
                .iter()
                .map(|host_ref| host_ref.get(env))
                .collect::<Result<Vec<JsInstance<'env, js_constructible_class::Host>>, napi::Error>>()?;
            ConvertedResult::Ok(hosts)
        })
    }
}
