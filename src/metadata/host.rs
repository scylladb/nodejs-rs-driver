use napi::bindgen_prelude::Buffer;
use napi::{JsValue, bindgen_prelude::JsObjectValue};

use crate::{session::SessionWrapper, utils::to_napi_obj::define_rust_to_js_convertible_object};

define_rust_to_js_convertible_object!(
    HostWrapper {
        host_id, hostId: Buffer,
        address, address: String,
        datacenter, datacenter: Option<String>,
        rack, rack: Option<String>,
    }
);

#[napi]
impl SessionWrapper {
    /// Due to using Napi structs, this endpoint is not very efficient.
    /// It should be retrieved lazily, whenever user requests information about hosts.
    #[napi]
    pub fn get_all_hosts(&self) -> Vec<HostWrapper> {
        self.inner
            .get_session()
            .get_cluster_state()
            .get_nodes_info()
            .iter()
            .map(|node| HostWrapper {
                host_id: Buffer::from(node.host_id.as_bytes().as_slice()),
                address: node.address.to_string(),
                datacenter: node.datacenter.clone(),
                rack: node.rack.clone(),
            })
            .collect()
    }
}
