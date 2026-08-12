use napi::Env;
use napi::bindgen_prelude::{
    FnArgs, FromNapiValue, Function, FunctionRef, JsValue, Object, Unknown,
};
use std::collections::HashMap;
use std::sync::Mutex;

use crate::types::type_helpers::SocketAddrWrapper;
use crate::utils::js_instance::JsInstance;
use crate::utils::to_napi_obj::{CopyableBuffer, NamedMap};

/// Zero-sized marker types naming each JS class that Rust constructs directly.
/// They exist only to parametrize `JsInstance` and, in turn, `NapiRef`.
pub mod js_constructible_class {
    /// Test-only marker for `TestJsClass(name, value)`, used by `crate::tests::napi_ref_tests`.
    pub enum TestJsClass {}
    pub enum SocketAddress {}
    pub enum Host {}
    pub enum HostMap {}
}

/// Arguments passed to the test-only `TestJsClass(name, value)` constructor.
type TestJsClassCtorArgs<'a> = FnArgs<(&'a str, i32)>;

/// Arguments passed to `net.SocketAddress({ address, port, family })`.
///
/// `net.SocketAddress` takes a single options object, which `SocketAddrWrapper`'s `ToNapiValue`
/// impl produces directly.
type SocketAddressCtorArgs = FnArgs<(SocketAddrWrapper,)>;

/// Arguments passed to `Host(address, datacenter, rack, hostId)`.
pub(crate) type HostCtorArgs<'a> = FnArgs<(
    JsInstance<'a, js_constructible_class::SocketAddress>,
    Option<&'a str>,
    Option<&'a str>,
    CopyableBuffer<'a>,
)>;

/// Arguments passed to `HostMap(items)`.
///
/// `items` is an already-built `Record<string, Host>`, keyed by the hex-encoded bytes of each
/// host's id.
type HostMapCtorArgs<'a> =
    FnArgs<(NamedMap<String, JsInstance<'a, js_constructible_class::Host>>,)>;

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
