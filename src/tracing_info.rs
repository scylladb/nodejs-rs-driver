use napi::bindgen_prelude::{Buffer, FnArgs, ToNapiValue};
use napi::{Env, sys};
use scylla::observability::tracing::{TracingEvent, TracingInfo};
use std::net::IpAddr;
use uuid::Uuid;

use crate::errors::{ConvertedError, ConvertedResult, JsResult, with_custom_error_async};
use crate::session::SessionWrapper;
use crate::utils::js_ctor::{
    QueryTraceCtorArgs, TracingEventCtorArgs, build_query_trace, build_tracing_event,
    js_constructible_class,
};
use crate::utils::js_instance::JsInstance;

/// Converts an `IpAddr` to its raw bytes (4 for IPv4, 16 for IPv6), for handing to the JS
/// `InetAddress` constructor, which itself takes a raw address buffer.
fn ip_addr_to_buffer(ip: IpAddr) -> Buffer {
    match ip {
        IpAddr::V4(v4) => Buffer::from(v4.octets().as_slice()),
        IpAddr::V6(v6) => Buffer::from(v6.octets().as_slice()),
    }
}

/// Converts a Rust `TracingEvent` to a JS `TracingEvent` instance.
fn convert_tracing_event(
    env: &Env,
    event: TracingEvent,
) -> napi::Result<JsInstance<'_, js_constructible_class::TracingEvent>> {
    let args: TracingEventCtorArgs<'_> = FnArgs::from((
        Buffer::from(event.event_id.as_bytes().as_slice()),
        event.activity.as_deref(),
        event.source.map(ip_addr_to_buffer),
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

    let args: QueryTraceCtorArgs<'_> = FnArgs::from((
        info.request.as_deref(),
        info.coordinator.map(ip_addr_to_buffer),
        info.parameters,
        info.started_at.map(|ts| ts.0),
        info.duration,
        info.client.map(ip_addr_to_buffer),
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
    #[napi(ts_return_type = "Promise<import('../lib/metadata/query-trace').QueryTrace>")]
    pub async fn get_tracing_info(&self, tracing_id: Buffer) -> JsResult<TracingInfoResult> {
        with_custom_error_async(async || {
            let tracing_id = Uuid::from_slice(tracing_id.as_ref()).map_err(ConvertedError::from)?;
            let info = self
                .inner
                .get_session()
                .get_tracing_info(&tracing_id)
                .await
                .map_err(ConvertedError::from)?;
            ConvertedResult::Ok(TracingInfoResult { inner: info })
        })
        .await
    }
}
