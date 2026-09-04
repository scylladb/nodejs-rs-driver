use napi::Env;
use napi::bindgen_prelude::{
    BigInt, FnArgs, FromNapiValue, Function, FunctionRef, JsValue, Object, Unknown,
};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::metadata::host::NodeHandle;
use crate::types::type_helpers::SocketAddrWrapper;
use crate::types::type_wrappers::ComplexType;
use crate::utils::js_instance::JsInstance;
use crate::utils::to_napi_obj::{CopyableBuffer, NamedMap};

/// Zero-sized marker types naming each JS class that Rust constructs directly.
/// They exist only to parametrize `JsInstance` and, in turn, `NapiRef`.
pub mod js_constructible_class {
    /// Test-only marker for `TestJsClass(name, value)`, used by `crate::tests::napi_ref_tests`.
    pub enum TestJsClass {}
    pub enum ColumnMetadata {}
    pub enum TableMetadata {}
    pub enum MaterializedView {}
    pub enum UdtField {}
    pub enum Udt {}
    pub enum SocketAddress {}
    pub enum Token {}
    pub enum Host {}
    pub enum SimpleStrategy {}
    pub enum NetworkTopologyStrategy {}
    pub enum LocalStrategy {}
    pub enum OtherStrategy {}
    pub enum HostMap {}
    pub enum TracingEvent {}
    pub enum QueryTrace {}
}

/// Arguments passed to the test-only `TestJsClass(name, value)` constructor.
#[cfg(feature = "tests")]
type TestJsClassCtorArgs<'a> = FnArgs<(&'a str, i32)>;

/// Arguments passed to `net.SocketAddress({ address, port, family })`.
///
/// `net.SocketAddress` takes a single options object, which `SocketAddrWrapper`'s `ToNapiValue`
/// impl produces directly.
type SocketAddressCtorArgs = FnArgs<(SocketAddrWrapper,)>;

/// Arguments passed to `Token(value)`.
type TokenCtorArgs = FnArgs<(BigInt,)>;

/// Arguments passed to `Host(address, datacenter, rack, hostId)`.
pub(crate) type HostCtorArgs<'a> = FnArgs<(
    JsInstance<'a, js_constructible_class::SocketAddress>,
    Option<&'a str>,
    Option<&'a str>,
    CopyableBuffer<'a>,
    NodeHandle,
)>;

/// Arguments passed to `HostMap(items)`.
///
/// `items` is an already-built `Record<string, Host>`, keyed by the hex-encoded bytes of each
/// host's id.
type HostMapCtorArgs<'a> =
    FnArgs<(NamedMap<String, JsInstance<'a, js_constructible_class::Host>>,)>;

/// Columns of a table/materialized view, as an already-built `Record<string, ColumnMetadata>`.
type ColumnsArg<'a> = NamedMap<&'a str, JsInstance<'a, js_constructible_class::ColumnMetadata>>;

/// Arguments passed to `ColumnMetadata(typ, kind)`.
type ColumnMetadataCtorArgs<'a> = FnArgs<(ComplexType<'a>, u32)>;

/// Arguments passed to `TableMetadata(columns, partitionKey, clusteringKey, partitioner)`.
type TableMetadataCtorArgs<'a> = FnArgs<(
    ColumnsArg<'a>,
    &'a Vec<String>,
    &'a Vec<String>,
    Option<&'a str>,
)>;

/// Arguments passed to
/// `MaterializedView(columns, partitionKey, clusteringKey, partitioner, tableName)`.
type MaterializedViewCtorArgs<'a> = FnArgs<(
    ColumnsArg<'a>,
    &'a Vec<String>,
    &'a Vec<String>,
    Option<&'a str>,
    &'a str,
)>;

/// Arguments passed to `UdtField(name, typ)`.
type UdtFieldCtorArgs<'a> = FnArgs<(&'a str, ComplexType<'a>)>;

/// Arguments passed to `Udt(name, keyspace, fields)`.
type UdtCtorArgs<'a> = FnArgs<(
    &'a str,
    &'a str,
    Vec<JsInstance<'a, js_constructible_class::UdtField>>,
)>;

/// Arguments passed to `SimpleStrategy(replicationFactor)`.
type SimpleStrategyCtorArgs = FnArgs<(u32,)>;

/// Arguments passed to `NetworkTopologyStrategy(datacenterRepfactors)`, as an already-built
/// `Record<string, number>` keyed by datacenter name.
type NetworkTopologyStrategyCtorArgs<'a> = FnArgs<(NamedMap<&'a str, u32>,)>;

/// Arguments passed to `OtherStrategy(name, data)`, where `data` is an already-built
/// `Record<string, string>` of parameters the driver does not interpret.
type OtherStrategyCtorArgs<'a> = FnArgs<(&'a str, NamedMap<&'a str, &'a str>)>;

/// Arguments passed to `TracingEvent(id, activity, source, elapsed, thread)`.
///
/// `id` is the raw 16-byte timeuuid, and `source` is the raw 4- or 16-byte IP address.
pub(crate) type TracingEventCtorArgs<'a> = FnArgs<(
    CopyableBuffer<'a>,
    Option<&'a str>,
    Option<CopyableBuffer<'a>>,
    Option<i32>,
    Option<&'a str>,
)>;

/// Arguments passed to
/// `QueryTrace(requestType, coordinator, parameters, startedAt, duration, clientAddress, events)`.
///
/// `coordinator`/`clientAddress` are raw IP address bytes (converted to `InetAddress` inside the
/// JS constructor), `parameters` is an already-built `Record<string, string>` of the parameters,
/// and `events` is an array of already-built `TracingEvent` instances.
pub(crate) type QueryTraceCtorArgs<'a> = FnArgs<(
    Option<&'a str>,
    Option<CopyableBuffer<'a>>,
    Option<NamedMap<String, String>>,
    Option<i64>,
    Option<i32>,
    Option<CopyableBuffer<'a>>,
    Vec<JsInstance<'a, js_constructible_class::TracingEvent>>,
)>;

/// Defines a per-environment constructor registry for a single pure-JS class, together with:
/// - a `#[napi]` `register_*_ctor` function that JS calls once per environment, at module load
///   time, to hand Rust a reference to the class's constructor;
/// - a `pub(crate)` `build_*` function that constructs a new instance of that class directly,
///   given the constructor arguments.
///
/// A single OS thread can host multiple, independent N-API environments, so the registry
/// is keyed by `napi_env` to avoid collisions between them.
///
/// The registry must be a single, static `HashMap<usize, FunctionRef<...>>`, so its value type
/// must be fixed once and for all at compile time. But `$args_ty` (the constructor's argument
/// type) is often borrowed, and that lifetime `'a` belongs to one specific call to `$build_fn`,
/// not to the `'static` registry. So we cannot store `FunctionRef<$args_ty, ()>` directly.
/// Instead, the registry stores every constructor's `FunctionRef` under the same erased
/// `Function<(), ()>` type, regardless of the class's real constructor signature, so that a single
/// `HashMap<usize, FunctionRef<(), ()>>` can hold `FunctionRef`s for all classes defined with
/// this macro. Erasing the `Args` type here means we now need to re-tag the constructor's
/// phantom `Args` type parameter back to this call's real (possibly borrowed) argument type
/// before we can call it with real arguments.
///
/// To cache the `FunctionRef` for each environment, we erase the `Args` type parameter to `()`
/// (`register_fn`'s parameter is `Function<(), ()>`). `Function::new_instance` takes the exact
/// same `Args` type the `Function` handle was typed with, so we re-tag it to the call's real
/// argument type via `Function::from_napi_value`.
///
/// The `Return` type parameter of the underlying `Function`/`FunctionRef` is always ignored: it is
/// only used by `Function::call`, but we always construct instances with `Function::new_instance`,
/// so we set it to arbitrary `()`.
macro_rules! define_js_ctor {
    (
        $(#[$doc:meta])*
        static_name: $static_name:ident,
        register_fn: $register_fn:ident,
        build_fn: $build_fn:ident,
        args: $args_ty:ty,
        class_name: $class_name:ident,
    ) => {
        $(#[$doc])*
        static $static_name: Mutex<Option<HashMap<usize, FunctionRef<(), ()>>>> =
            Mutex::new(None);

        /// Registers the JS class constructor, so that Rust can later construct fully-formed JS instances
        /// directly. It is called exactly once per N-API environment (i.e. once per `worker_threads` worker,
        /// and once on the main thread), by the corresponding module on load, before any cluster metadata
        /// is accessed in that environment.
        #[napi]
        pub fn $register_fn(
            #[napi(ts_arg_type = "new (...args: any[]) => any")] ctor: Function<(), ()>,
            env: Env,
        ) -> napi::Result<()> {
            let ctor_ref = ctor.create_ref()?;
            let key = env.raw() as usize;
            {
                let registry = $static_name.lock().unwrap();
                if registry.as_ref().is_some_and(|registry| registry.contains_key(&key)) {
                    return Err(napi::Error::from_reason(concat!(
                        stringify!($register_fn),
                        " was called more than once in this environment; ",
                        stringify!($class_name),
                        " constructor is already registered",
                    )));
                }
            }
            // Register the cleanup hook - which removes this environment's entry, dropping its `FunctionRef`,
            // exactly when this specific environment is torn down, rather than leaving it to linger past its
            // environment's lifetime or be silently reused by a later environment that happens to be allocated
            // at the same address.
            env.add_env_cleanup_hook(key, |key| {
                if let Some(registry) = $static_name.lock().unwrap().as_mut() {
                    registry.remove(&key);
                }
            })?;
            $static_name
                .lock()
                .unwrap()
                .get_or_insert_with(HashMap::new)
                .insert(key, ctor_ref);
            Ok(())
        }

        /// Constructs a JS class instance directly, by calling its constructor, registered via register_fn.
        /// The returned object's lifetime is tied to the `&'env Env` borrow passed in: the `napi_value` is
        /// only guaranteed to remain a valid, live GC root for as long as that handle scope is on the stack.
        /// This prevents the returned object from silently outliving the native call.
        pub(crate) fn $build_fn<'env>(
            env: &'env Env,
            args: $args_ty,
        ) -> napi::Result<JsInstance<'env, js_constructible_class::$class_name>> {
            let key = env.raw() as usize;
            let ctor: Function<'_, (), ()> = {
                let registry = $static_name.lock().unwrap();
                let ctor_ref = registry.as_ref().and_then(|registry| registry.get(&key)).ok_or_else(|| {
                    napi::Error::from_reason(concat!(
                        stringify!($class_name),
                        " constructor is not registered yet; ensure correct module has been ",
                        "loaded before accessing cluster metadata",
                    ))
                })?;
                ctor_ref.borrow_back(env)?
            };
            // Re-tag the constructor's phantom `Args` type parameter to this call's real
            // (possibly borrowed) argument type.
            let ctor: Function<'_, $args_ty, ()> =
                unsafe { Function::from_napi_value(env.raw(), ctor.raw())? };
            let instance: Unknown = ctor.new_instance(args)?;
            Ok(JsInstance::from_object(Object::from_raw(env.raw(), instance.raw())))
        }
    };
}

#[cfg(feature = "tests")]
define_js_ctor!(
    /// `TestJsClass(name, value)` - test-only class used by `crate::tests::napi_ref_tests`.
    static_name: TEST_JS_CLASS_CTOR,
    register_fn: register_test_js_class_ctor,
    build_fn: build_test_js_class,
    args: TestJsClassCtorArgs<'_>,
    class_name: TestJsClass,
);

define_js_ctor!(
    /// `net.SocketAddress({ address, port, family })` - Node's built-in socket address class,
    /// registered by `lib/host.js` so that Rust can hand back already-parsed host addresses.
    static_name: SOCKET_ADDRESS_CTOR,
    register_fn: register_socket_address_ctor,
    build_fn: build_socket_address,
    args: SocketAddressCtorArgs,
    class_name: SocketAddress,
);

define_js_ctor!(
    /// `SimpleStrategy(replicationFactor)`.
    static_name: SIMPLE_STRATEGY_CTOR,
    register_fn: register_simple_strategy_ctor,
    build_fn: build_simple_strategy,
    args: SimpleStrategyCtorArgs,
    class_name: SimpleStrategy,
);

define_js_ctor!(
    /// `NetworkTopologyStrategy(datacenterRepfactors)`.
    static_name: NETWORK_TOPOLOGY_STRATEGY_CTOR,
    register_fn: register_network_topology_strategy_ctor,
    build_fn: build_network_topology_strategy,
    args: NetworkTopologyStrategyCtorArgs<'_>,
    class_name: NetworkTopologyStrategy,
);

define_js_ctor!(
    /// `LocalStrategy()`.
    static_name: LOCAL_STRATEGY_CTOR,
    register_fn: register_local_strategy_ctor,
    build_fn: build_local_strategy,
    args: (),
    class_name: LocalStrategy,
);

define_js_ctor!(
    /// `OtherStrategy(name, data)`.
    static_name: OTHER_STRATEGY_CTOR,
    register_fn: register_other_strategy_ctor,
    build_fn: build_other_strategy,
    args: OtherStrategyCtorArgs<'_>,
    class_name: OtherStrategy,
);

define_js_ctor!(
    /// `Token(value)`.
    static_name: TOKEN_CTOR,
    register_fn: register_token_ctor,
    build_fn: build_token,
    args: TokenCtorArgs,
    class_name: Token,
);

define_js_ctor!(
    /// `Host(address, datacenter, rack, hostId)`
    static_name: HOST_CTOR,
    register_fn: register_host_ctor,
    build_fn: build_host,
    args: HostCtorArgs<'_>,
    class_name: Host,
);

define_js_ctor!(
    /// `HostMap(items)`
    /// `items` is an already-built `Map<string, Host>`.
    static_name: HOST_MAP_CTOR,
    register_fn: register_host_map_ctor,
    build_fn: build_host_map,
    args: HostMapCtorArgs<'_>,
    class_name: HostMap,
);

define_js_ctor!(
    /// `ColumnMetadata(typ, kind)`
    static_name: COLUMN_METADATA_CTOR,
    register_fn: register_column_metadata_ctor,
    build_fn: build_column_metadata,
    args: ColumnMetadataCtorArgs<'_>,
    class_name: ColumnMetadata,
);

define_js_ctor!(
    /// `TableMetadata(columns, partitionKey, clusteringKey, partitioner)`
    /// `columns` is an already-built `Record<string, ColumnMetadata>`
    static_name: TABLE_METADATA_CTOR,
    register_fn: register_table_metadata_ctor,
    build_fn: build_table_metadata,
    args: TableMetadataCtorArgs<'_>,
    class_name: TableMetadata,
);

define_js_ctor!(
    /// `MaterializedView(columns, partitionKey, clusteringKey, partitioner, tableName)`
    /// `columns` is an already-built `Record<string, ColumnMetadata>`
    static_name: MATERIALIZED_VIEW_CTOR,
    register_fn: register_materialized_view_ctor,
    build_fn: build_materialized_view,
    args: MaterializedViewCtorArgs<'_>,
    class_name: MaterializedView,
);

define_js_ctor!(
    /// `UdtField(name, typ)`
    static_name: UDT_FIELD_CTOR,
    register_fn: register_udt_field_ctor,
    build_fn: build_udt_field,
    args: UdtFieldCtorArgs<'_>,
    class_name: UdtField,
);

define_js_ctor!(
    /// `Udt(name, keyspace, fields)`
    /// `fields` is an array of `UdtField` instances
    static_name: UDT_CTOR,
    register_fn: register_udt_ctor,
    build_fn: build_udt,
    args: UdtCtorArgs<'_>,
    class_name: Udt,
);

define_js_ctor!(
    /// `TracingEvent(id, activity, source, elapsed, thread)`
    static_name: TRACING_EVENT_CTOR,
    register_fn: register_tracing_event_ctor,
    build_fn: build_tracing_event,
    args: TracingEventCtorArgs<'_>,
    class_name: TracingEvent,
);

define_js_ctor!(
    /// `QueryTrace(requestType, coordinator, parameters, startedAt, duration, clientAddress, events)`
    /// `events` is an array of `TracingEvent` instances
    static_name: QUERY_TRACE_CTOR,
    register_fn: register_query_trace_ctor,
    build_fn: build_query_trace,
    args: QueryTraceCtorArgs<'_>,
    class_name: QueryTrace,
);
