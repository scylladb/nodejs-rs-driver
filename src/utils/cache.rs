use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use napi::Env;
use napi::bindgen_prelude::Reference;

use crate::errors::{ConvertedError, ConvertedResult};
use crate::utils::js_instance::JsInstance;
use crate::utils::napi_ref::NapiRef;

/// A lazily-populated cache for `#[napi]` class instances, keyed by name.
/// The same `Reference<V>` (and therefore the same underlying JS object) is handed
/// out for a given key across repeated lookups, whether it is reached through the
/// single-key path or the full-map path.
///
/// # Concurrency
///
/// These caches only ever live inside N-API class instances that are exclusively
/// accessed on the JS thread. A plain `RefCell` is therefore sufficient and no
/// locking is required.
pub struct ReferenceCache<V: 'static> {
    map: RefCell<HashMap<String, Reference<V>>>,
    /// Set once `get_or_init_all`'s builder has run to completion.
    complete: Cell<bool>,
}

impl<V: 'static> Default for ReferenceCache<V> {
    fn default() -> Self {
        Self::new()
    }
}

impl<V: 'static> ReferenceCache<V> {
    pub fn new() -> Self {
        ReferenceCache {
            map: RefCell::new(HashMap::new()),
            complete: Cell::new(false),
        }
    }

    /// Retrieves a single cached value or initializes it lazily if missing.
    /// - If the key exists: returns a clone of the cached `Reference<V>`.
    /// - If the key is missing and the full set has already been loaded via `get_or_init_all`
    ///   (i.e. this cache is `complete`): the miss is authoritative, so `f` is not called and
    ///   `Ok(None)` is returned directly.
    /// - Otherwise: computes the value with `f`, inserts it (if `Some`) and returns it.
    pub fn get_or_init<F>(&self, env: Env, key: &str, f: F) -> ConvertedResult<Option<Reference<V>>>
    where
        F: FnOnce() -> ConvertedResult<Option<Reference<V>>>,
    {
        if let Some(existing) = self.map.borrow().get(key) {
            return Ok(Some(existing.clone(env).map_err(ConvertedError::from)?));
        }

        if self.complete.get() {
            return Ok(None);
        }

        let Some(value) = f()? else {
            return Ok(None);
        };

        let mut map = self.map.borrow_mut();
        let stored = map.entry(key.to_owned()).or_insert(value);
        Ok(Some(stored.clone(env).map_err(ConvertedError::from)?))
    }

    /// Computes the full set of entries via `f` the first time this is called, and
    /// returns a snapshot of the cache on every call. Subsequent calls skip `f`
    /// entirely, avoiding both redundant conversion work and any freshly-created
    /// values that would otherwise be immediately discarded.
    ///
    /// The returned entries are fresh clones of the cached references, so they can be
    /// handed to JS while the cache keeps ownership of the originals.
    pub fn get_or_init_all<F>(
        &self,
        env: Env,
        f: F,
    ) -> ConvertedResult<HashMap<String, Reference<V>>>
    where
        F: FnOnce() -> ConvertedResult<HashMap<String, Reference<V>>>,
    {
        if !self.complete.get() {
            // `f` is computed before the map is borrowed mutably, so that any reentrant
            // access to this cache from within `f` (e.g. a JS constructor invoked while
            // building one of the values) does not panic on an already-borrowed `RefCell`.
            let built = f()?;
            let mut map = self.map.borrow_mut();
            for (key, value) in built {
                map.entry(key).or_insert(value);
            }
            self.complete.set(true);
        }

        self.map
            .borrow()
            .iter()
            .map(|(key, value)| Ok((key.clone(), value.clone(env).map_err(ConvertedError::from)?)))
            .collect()
    }
}

/// A lazily-populated cache for plain JS objects (i.e. `JsInstance<'_, C>` values that are not
/// wrapped as `#[napi]` class instances), keyed by name. The same `NapiRef<C>` (and therefore
/// the same underlying JS object) is handed out for a given key across repeated lookups, whether
/// it is reached through the single-key path or the full-map path.
///
/// # Concurrency
///
/// Same as `ReferenceCache<V>`: only ever accessed on the JS thread, so a plain `RefCell` suffices.
pub struct NapiRefCache<C: 'static> {
    map: RefCell<HashMap<String, NapiRef<C>>>,
    /// Set once `get_or_init_all`'s builder has run to completion.
    complete: Cell<bool>,
}

impl<C: 'static> Default for NapiRefCache<C> {
    fn default() -> Self {
        Self::new()
    }
}

impl<C: 'static> NapiRefCache<C> {
    pub fn new() -> Self {
        NapiRefCache {
            map: RefCell::new(HashMap::new()),
            complete: Cell::new(false),
        }
    }

    /// Retrieves a single cached value or initializes it lazily if missing.
    /// - If the key exists: returns the cached value.
    /// - If the key is missing and the full set has already been loaded via `get_or_init_all`
    ///   (i.e. this cache is `complete`): the miss is authoritative, so `f` is not called and
    ///   `Ok(None)` is returned directly.
    /// - Otherwise: computes the value with `f`, inserts it (if `Some`) and returns it.
    pub fn get_or_init<'env, F>(
        &self,
        env: &'env Env,
        key: &str,
        f: F,
    ) -> ConvertedResult<Option<JsInstance<'env, C>>>
    where
        F: FnOnce() -> ConvertedResult<Option<JsInstance<'env, C>>>,
    {
        if let Some(existing) = self.map.borrow().get(key) {
            return Ok(Some(existing.get(env).map_err(ConvertedError::from)?));
        }

        if self.complete.get() {
            return Ok(None);
        }

        let Some(value) = f()? else {
            return Ok(None);
        };

        let napi_ref = NapiRef::new(env, value).map_err(ConvertedError::from)?;
        let mut map = self.map.borrow_mut();
        let stored = map.entry(key.to_owned()).or_insert(napi_ref);
        Ok(Some(stored.get(env)?))
    }

    /// Computes the full set of entries via `f` the first time this is called (pinning each
    /// converted value behind a `NapiRef<C>`), and returns every cached entry's current JS handle,
    /// as a `JsInstance<'env, C>` tied to `env`'s lifetime, on every call. Subsequent calls skip `f`
    /// entirely, avoiding both redundant conversion work and leaking a freshly-pinned-but-discarded
    /// JS object per call.
    pub fn get_or_init_all<'env, F>(
        &self,
        env: &'env Env,
        f: F,
    ) -> ConvertedResult<HashMap<String, JsInstance<'env, C>>>
    where
        F: FnOnce() -> ConvertedResult<HashMap<String, JsInstance<'env, C>>>,
    {
        if !self.complete.get() {
            // `f` and every `NapiRef` are built before the map is borrowed mutably, so
            // that any reentrant access to this cache from within `f` (e.g. a JS
            // constructor invoked while building one of the values) does not panic on
            // an already-borrowed `RefCell`.
            let built = f()?
                .into_iter()
                .map(|(key, value)| {
                    let napi_ref = NapiRef::new(env, value).map_err(ConvertedError::from)?;
                    Ok((key, napi_ref))
                })
                .collect::<ConvertedResult<Vec<_>>>()?;
            let mut map = self.map.borrow_mut();
            for (key, napi_ref) in built {
                map.entry(key).or_insert(napi_ref);
            }
            self.complete.set(true);
        }

        self.map
            .borrow()
            .iter()
            .map(|(key, napi_ref)| {
                let value = napi_ref.get(env).map_err(ConvertedError::from)?;
                Ok((key.clone(), value))
            })
            .collect()
    }
}
