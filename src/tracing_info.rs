use napi::bindgen_prelude::{Buffer, FnArgs, ToNapiValue};
use napi::{Env, sys};
use scylla::observability::tracing::{TracingEvent, TracingInfo};
use std::net::IpAddr;
use std::sync::Arc;
use uuid::Uuid;

use crate::async_bridge::{JsAsyncResult, submit_future};
use crate::errors::{ConvertedError, ConvertedResult, with_custom_error_sync};
use crate::session::SessionWrapper;
use crate::utils::js_ctor::{
    QueryTraceCtorArgs, TracingEventCtorArgs, build_query_trace, build_tracing_event,
    js_constructible_class,
};
use crate::utils::js_instance::JsInstance;
use crate::utils::to_napi_obj::{CopyableBuffer, NamedMap};

/// The raw bytes of an `IpAddr` (4 for IPv4, 16 for IPv6), which is what the JS `InetAddress`
/// constructor takes.
///
/// The octets are kept in this owned, stack-allocated form so that a `CopyableBuffer` can borrow
/// them while the constructor arguments are assembled - copying them into a JS-owned `Buffer`
/// instead of handing an external buffer over to napi, which is far more expensive for
/// allocations this small.
enum IpAddrOctets {
    V4([u8; 4]),
    V6([u8; 16]),
}

impl From<IpAddr> for IpAddrOctets {
    fn from(ip: IpAddr) -> Self {
        match ip {
            IpAddr::V4(v4) => IpAddrOctets::V4(v4.octets()),
            IpAddr::V6(v6) => IpAddrOctets::V6(v6.octets()),
        }
    }
}

impl IpAddrOctets {
    fn as_buffer(&self) -> CopyableBuffer<'_> {
        CopyableBuffer::new(match self {
            IpAddrOctets::V4(octets) => octets.as_slice(),
            IpAddrOctets::V6(octets) => octets.as_slice(),
        })
    }
}

/// Converts a Rust `TracingEvent` to a JS `TracingEvent` instance.
fn convert_tracing_event(
    env: &Env,
    event: TracingEvent,
) -> napi::Result<JsInstance<'_, js_constructible_class::TracingEvent>> {
    let source = event.source.map(IpAddrOctets::from);
    let args: TracingEventCtorArgs<'_> = FnArgs::from((
        CopyableBuffer::new(event.event_id.as_bytes().as_slice()),
        event.activity.as_deref(),
        source.as_ref().map(IpAddrOctets::as_buffer),
        event.source_elapsed,
        event.thread.as_deref(),
    ));
    build_tracing_event(env, args)
}

/// Converts a Rust `TracingInfo` to a JS `QueryTrace` instance.
fn convert_query_trace<'env>(
    env: &'env Env,
    info: TracingInfo,
) -> napi::Result<JsInstance<'env, js_constructible_class::QueryTrace>> {
    let events = info
        .events
        .into_iter()
        .map(|event| convert_tracing_event(env, event))
        .collect::<napi::Result<Vec<_>>>()?;

    let coordinator = info.coordinator.map(IpAddrOctets::from);
    let client = info.client.map(IpAddrOctets::from);
    let args: QueryTraceCtorArgs<'_> = FnArgs::from((
        info.request.as_deref(),
        coordinator.as_ref().map(IpAddrOctets::as_buffer),
        info.parameters.map(NamedMap::new),
        info.started_at.map(|ts| ts.0),
        info.duration,
        client.as_ref().map(IpAddrOctets::as_buffer),
        events,
    ));
    build_query_trace(env, args)
}

/// Owned, `Send` carrier for a `TracingInfo` retrieved by `get_tracing_info`.
///
/// Async `#[napi]` methods must return a value that is `Send + 'static`, but a `JsInstance`
/// is neither - those are only ever safe to touch on the JS thread. So we cannot build the
/// `QueryTrace`/`TracingEvent` instances (which requires calling into their registered
/// constructors, a JS-thread-only operation) from inside the `async` body. Instead, this
/// struct carries the plain, `Send` `TracingInfo` data across that boundary unchanged, and
/// only builds the real JS instances in `ToNapiValue::to_napi_value`, which napi-rs always
/// calls back on the JS thread.
pub struct TracingInfoResult {
    inner: TracingInfo,
}

impl ToNapiValue for TracingInfoResult {
    unsafe fn to_napi_value(env: sys::napi_env, val: Self) -> napi::Result<sys::napi_value> {
        let env_struct = Env::from_raw(env);
        let instance = convert_query_trace(&env_struct, val.inner)?;
        unsafe { ToNapiValue::to_napi_value(env, instance) }
    }
}

#[napi]
impl SessionWrapper {
    /// Retrieves the tracing information for a previously executed, traced query,
    /// given the tracing id returned by that query's result.
    #[napi(ts_return_type = "Promise<import('./lib/metadata/query-trace').QueryTrace>")]
    pub fn get_tracing_info(
        &self,
        env: Env,
        tracing_id: Buffer,
    ) -> JsAsyncResult<TracingInfoResult> {
        with_custom_error_sync(|| {
            let tracing_id = Uuid::from_slice(tracing_id.as_ref()).map_err(ConvertedError::from)?;
            let inner = Arc::clone(&self.inner);
            submit_future(&env, async move {
                let info = inner
                    .get_session()
                    .get_tracing_info(&tracing_id)
                    .await
                    .map_err(ConvertedError::from)?;
                ConvertedResult::Ok(TracingInfoResult { inner: info })
            })
        })
    }
}
