use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use napi::Env;
use napi::bindgen_prelude::Reference;

use crate::errors::{ConvertedError, ConvertedResult};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;

/// One of the two ways a converted JS value can be kept alive in a `JsCache`.
///
/// The cache logic is identical for both; they differ only in how a value is pinned against
/// garbage collection (`store`) and how a fresh handle to it is produced on lookup (`load`).
pub trait CacheEntry: Sized + 'static {
    /// The value the cache is handed when an entry is created, and hands back out on lookup.
    ///
    /// This is generic over the N-API handle scope's lifetime because handles to plain JS objects
    /// (`JsInstance<'env, C>`) are only valid within the scope they were obtained in, so a fresh
    /// one has to be produced per lookup rather than stored.
    type Value<'env>;

    /// Pins `value`, producing the entry to store in the cache.
    fn store<'env>(env: &'env Env, value: Self::Value<'env>) -> ConvertedResult<Self>;

    /// Produces a fresh handle to the cached value, tied to `env`'s handle scope.
    fn load<'env>(&self, env: &'env Env) -> ConvertedResult<Self::Value<'env>>;
}

/// `#[napi]` class instances: napi-rs already keeps them alive behind a reference count, so the
/// `Reference<V>` is stored directly and cloned for each lookup.
impl<V: 'static> CacheEntry for Reference<V> {
    type Value<'env> = Reference<V>;

    fn store(_env: &Env, value: Reference<V>) -> ConvertedResult<Self> {
        Ok(value)
    }

    fn load(&self, env: &Env) -> ConvertedResult<Reference<V>> {
        self.clone(*env).map_err(ConvertedError::from)
    }
}

/// Plain JS objects (classes built with `js_ctor`): these have to be pinned behind a raw `napi_ref`.
impl<C: 'static> CacheEntry for NapiRef<C> {
    type Value<'env> = JsInstance<'env, C>;

    fn store<'env>(env: &'env Env, value: JsInstance<'env, C>) -> ConvertedResult<Self> {
        NapiRef::new(env, value).map_err(ConvertedError::from)
    }

    fn load<'env>(&self, env: &'env Env) -> ConvertedResult<JsInstance<'env, C>> {
        self.get(env).map_err(ConvertedError::from)
    }
}

/// A lazily-populated cache for converted JS values, keyed by name.
///
/// The same underlying JS object is handed out for a given key across repeated lookups, whether it
/// is reached through the single-key path `get_or_init` or the full-map path (`get_or_init_all`).
///
/// # Concurrency
///
/// These caches only ever live inside N-API class instances that are exclusively accessed on the
/// JS thread. A plain `RefCell` is therefore sufficient and no locking is required.
pub struct JsCache<E: CacheEntry> {
    map: RefCell<HashMap<String, E>>,
    /// Set once `get_or_init_all`'s builder has run to completion.
    complete: Cell<bool>,
}

/// Cache of `#[napi]` class instances.
pub type ReferenceCache<V> = JsCache<Reference<V>>;

/// Cache of plain JS objects built through `js_ctor`.
pub type NapiRefCache<C> = JsCache<NapiRef<C>>;

impl<E: CacheEntry> Default for JsCache<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E: CacheEntry> JsCache<E> {
    pub fn new() -> Self {
        JsCache {
            map: RefCell::new(HashMap::new()),
            complete: Cell::new(false),
        }
    }

    /// Retrieves a single cached value or initializes it lazily if missing.
    /// - If the key exists: returns a fresh handle to the cached value.
    /// - If the key is missing and the full set has already been loaded via `get_or_init_all`
    ///   (i.e. this cache is `complete`): the miss is authoritative, so `f` is not called and
    ///   `Ok(None)` is returned directly.
    /// - Otherwise: computes the value with `f`, inserts it (if `Some`) and returns it.
    pub fn get_or_init<'env, F>(
        &self,
        env: &'env Env,
        key: &str,
        f: F,
    ) -> ConvertedResult<Option<E::Value<'env>>>
    where
        F: FnOnce() -> ConvertedResult<Option<E::Value<'env>>>,
    {
        if let Some(existing) = self.map.borrow().get(key) {
            return Ok(Some(existing.load(env)?));
        }

        if self.complete.get() {
            return Ok(None);
        }

        let Some(value) = f()? else {
            return Ok(None);
        };

        // The entry is built before the map is borrowed mutably, so that any reentrant access to
        // this cache from within `f` or from `store` (e.g. a JS constructor invoked while building
        // the value) does not panic on an already-borrowed `RefCell`.
        let entry = E::store(env, value)?;
        let mut map = self.map.borrow_mut();
        let stored = map.entry(key.to_owned()).or_insert(entry);
        Ok(Some(stored.load(env)?))
    }

    /// Computes the full set of entries via `f` the first time this is called, and returns every
    /// cached entry's current handle on every call. Subsequent calls skip `f` entirely, avoiding
    /// both redundant conversion work and any freshly-pinned-but-discarded JS objects.
    ///
    /// The returned handles are fresh, so they can be handed to JS while the cache keeps ownership
    /// of the pinned originals.
    pub fn get_or_init_all<'env, F>(
        &self,
        env: &'env Env,
        f: F,
    ) -> ConvertedResult<HashMap<String, E::Value<'env>>>
    where
        F: FnOnce() -> ConvertedResult<HashMap<String, E::Value<'env>>>,
    {
        if !self.complete.get() {
            // As in `get_or_init`, every entry is built before the map is borrowed mutably, so a
            // reentrant cache access from within `f`/`store` cannot panic on the `RefCell`.
            let built = f()?
                .into_iter()
                .map(|(key, value)| Ok((key, E::store(env, value)?)))
                .collect::<ConvertedResult<Vec<_>>>()?;
            let mut map = self.map.borrow_mut();
            for (key, entry) in built {
                map.entry(key).or_insert(entry);
            }
            self.complete.set(true);
        }

        self.map
            .borrow()
            .iter()
            .map(|(key, entry)| Ok((key.clone(), entry.load(env)?)))
            .collect()
    }
}
