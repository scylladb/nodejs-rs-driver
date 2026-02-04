use std::net::{IpAddr, SocketAddr};

use napi::bindgen_prelude::FromNapiValue;

use crate::errors::make_js_error;

/// A type wrapper over `SocketAddr` to facilitate its usage over napi.
/// Can be created from net.SocketAddress object, or a duck-typed object with `address` and `port` fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SocketAddrWrapper {
    pub(crate) socket: SocketAddr,
}

impl FromNapiValue for SocketAddrWrapper {
    /// # Safety
    ///
    /// Valid pointer to napi env must be provided
    unsafe fn from_napi_value(
        env: napi::sys::napi_env,
        napi_val: napi::sys::napi_value,
    ) -> napi::Result<Self> {
        // Caller of this function ensures a valid pointer to napi env is provided
        let o = unsafe { ::napi::bindgen_prelude::Object::from_napi_value(env, napi_val) }?;

        let ip_str: String = o.get::<String>("address")?.ok_or_else(|| {
            make_js_error("Cannot retrieve socket address. Missing address field")
        })?;

        let port: u16 = o
            .get::<u16>("port")?
            .ok_or_else(|| make_js_error("Cannot retrieve socket address. Missing port field"))?;

        let ip: IpAddr = ip_str
            .parse()
            .map_err(|e| make_js_error(format!("Could not parse IP address: {}", e)))?;

        Ok(SocketAddrWrapper {
            socket: SocketAddr::new(ip, port),
        })
    }
}

impl SocketAddrWrapper {
    pub(crate) fn into_inner(self) -> SocketAddr {
        self.socket
    }
}
