use napi::Env;
use napi::bindgen_prelude::{Buffer, FnArgs, Function, FunctionRef, JsValue, Object};
use std::cell::RefCell;

use crate::types::type_wrappers::ComplexType;
use crate::utils::js_instance::JsInstance;

/// Zero-sized marker types naming each JS class that Rust constructs directly.
/// They exist only to parametrize `JsInstance` and, in turn, `NapiRef`.
pub mod js_constructible_class {
    pub enum ColumnMetadata {}
    pub enum TableMetadata {}
    pub enum MaterializedView {}
    pub enum Host {}
}

/// Columns of a table/materialized view, as an array of `[name, ColumnMetadata]` pairs.
type ColumnsArg = Vec<(
    String,
    JsInstance<'static, js_constructible_class::ColumnMetadata>,
)>;

/// Arguments passed to `ColumnMetadata(typ, kind)`.
type ColumnMetadataCtorArgs = FnArgs<(ComplexType<'static>, u32)>;

/// Arguments passed to `TableMetadata(columns, partitionKey, clusteringKey, partitioner)`.
type TableMetadataCtorArgs = FnArgs<(ColumnsArg, Vec<String>, Vec<String>, Option<String>)>;

/// Arguments passed to
/// `MaterializedView(columns, partitionKey, clusteringKey, partitioner, tableName)`.
type MaterializedViewCtorArgs =
    FnArgs<(ColumnsArg, Vec<String>, Vec<String>, Option<String>, String)>;

/// Arguments passed to `Host(address, datacenter, rack, hostId)`.
type HostCtorArgs = FnArgs<(String, Option<String>, Option<String>, Buffer)>;

/// Defines a per-thread constructor registry for a single pure-JS class, together with:
/// - a `#[napi]` `register_*_ctor` function that JS calls once, at module load time, to hand
///   Rust a reference to the class's constructor;
/// - a `pub(crate)` `build_*` function that constructs a new instance of that class directly,
///   given the constructor arguments.
///
/// The `Return` type parameter of the underlying `Function`/`FunctionRef` is always ignored:
/// it is only used by `Function::call`, whereas we always construct instances via
/// `Function::new_instance`, so we set it to arbitrary `()`.
macro_rules! define_js_ctor {
    (
        $(#[$doc:meta])*
        static_name: $static_name:ident,
        register_fn: $register_fn:ident,
        build_fn: $build_fn:ident,
        args: $args_ty:ty,
        class_name: $class_name:ident,
    ) => {
        thread_local! {
            /// When multiple threads are used (e.g. via `worker_threads`), each thread has its own environment
            /// and therefore its own copy of the JS constructor reference. `thread_local!` ensures that each
            /// thread has its own `RefCell<Option<FunctionRef<...>>>` slot.
            $(#[$doc])*
            static $static_name: RefCell<Option<FunctionRef<$args_ty, ()>>> = const { RefCell::new(None) };
        }

        /// Registers the JS class constructor, so that Rust can later construct fully-formed JS instances directly.
        /// It is called exactly once per thread (i.e. once per `worker_threads` worker, and once on the main thread),
        /// by the corresponding `lib/metadata/*.js` module on load, before any cluster metadata is accessed on that thread.
        #[napi]
        pub fn $register_fn(ctor: Function<$args_ty, ()>) -> napi::Result<()> {
            let ctor_ref = ctor.create_ref()?;
            $static_name.with(|cell| {
                let mut slot = cell.borrow_mut();
                if slot.is_some() {
                    return Err(napi::Error::from_reason(concat!(
                        stringify!($register_fn),
                        " was called more than once on this thread; ",
                        stringify!($class_name),
                        " constructor is already registered",
                    )));
                }
                *slot = Some(ctor_ref);
                Ok(())
            })
        }

        /// Constructs a JS class instance directly, by calling its constructor, registered via register_fn.
        ///
        /// The returned object's `'obj` lifetime is chosen by the caller: functions that return the
        /// object to JS tie it to the current `Env` borrow (so it cannot escape the native call),
        /// whereas the transient instances used as constructor arguments pin it to `'static`.
        pub(crate) fn $build_fn<'obj>(
            env: &Env,
            args: $args_ty,
        ) -> napi::Result<JsInstance<'obj, js_constructible_class::$class_name>> {
            $static_name.with(|cell| {
                let slot = cell.borrow();
                let ctor_ref = slot.as_ref().ok_or_else(|| {
                    napi::Error::from_reason(concat!(
                        stringify!($class_name),
                        " constructor is not registered yet; ensure lib/metadata/*.js has been ",
                        "loaded before accessing cluster metadata",
                    ))
                })?;
                let ctor = ctor_ref.borrow_back(env)?;
                let instance: napi::bindgen_prelude::Unknown = ctor.new_instance(args)?;
                Ok(JsInstance::from_object(Object::from_raw(env.raw(), instance.raw())))
            })
        }
    };
}

define_js_ctor!(
    /// `ColumnMetadata(typ, kind)`
    static_name: COLUMN_METADATA_CTOR,
    register_fn: register_column_metadata_ctor,
    build_fn: build_column_metadata,
    args: ColumnMetadataCtorArgs,
    class_name: ColumnMetadata,
);

define_js_ctor!(
    /// `TableMetadata(columns, partitionKey, clusteringKey, partitioner)`
    /// `columns` is an array of `[name, ColumnMetadata]`
    static_name: TABLE_METADATA_CTOR,
    register_fn: register_table_metadata_ctor,
    build_fn: build_table_metadata,
    args: TableMetadataCtorArgs,
    class_name: TableMetadata,
);

define_js_ctor!(
    /// `MaterializedView(columns, partitionKey, clusteringKey, partitioner, tableName)`
    /// `columns` is an array of `[name, ColumnMetadata]`
    static_name: MATERIALIZED_VIEW_CTOR,
    register_fn: register_materialized_view_ctor,
    build_fn: build_materialized_view,
    args: MaterializedViewCtorArgs,
    class_name: MaterializedView,
);

define_js_ctor!(
    /// `Host(address, datacenter, rack, hostId)`
    static_name: HOST_CTOR,
    register_fn: register_host_ctor,
    build_fn: build_host,
    args: HostCtorArgs,
    class_name: Host,
);
