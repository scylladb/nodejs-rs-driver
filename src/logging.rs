use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock};

use napi::bindgen_prelude::FnArgs;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use std::fmt::Write;
use tracing::Level;
use tracing::field::{Field, Visit};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{Layer, Registry};

/// Shorthand for the NAPI callback type.
///
/// Generic parameters: `CalleeHandled = false`, `Weak = true` so that the
/// callback does not prevent the Node.js event-loop from exiting.
type LogCallback = ThreadsafeFunction<
    /* T: */ FnArgs<(String, String, String, String)>,
    /* Return: */ (),
    /* CallJsBackArgs: */ FnArgs<(String, String, String, String)>,
    /* ErrorStatus: */ napi::Status,
    /* CalleeHandled: */ false,
    /* Weak: */ true,
>;

/// A callback registered by one client, together with the minimum severity
/// level it is interested in.
struct RegisteredCallback {
    id: u64,
    callback: LogCallback,
    min_level: Level,
}

/// Monotonically increasing id counter for registered callbacks.
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// Registry of all currently-active per-client callbacks.
/// Initialized (and the global subscriber installed) on the first call to
/// `setup_logging`.
static CALLBACKS: OnceLock<RwLock<Vec<RegisteredCallback>>> = OnceLock::new();

/// Return the callback registry, lazily installing the global tracing
/// subscriber the very first time this is called.
fn get_or_init_callbacks() -> &'static RwLock<Vec<RegisteredCallback>> {
    CALLBACKS.get_or_init(|| {
        let subscriber = Registry::default().with(JsForwardingLayer);
        tracing::subscriber::set_global_default(subscriber).unwrap_or_else(|e| {
            // This will fail only of there is already a global subscriber, which we should prevent from happening.
            panic!("This is likely due to a bug in the driver: failed to initialized logger. {e}");
        });
        RwLock::new(Vec::new())
    })
}

/// Maps a Rust `tracing::Level` to the JS log-level strings.
fn rust_level_to_js(level: &Level) -> &'static str {
    match *level {
        Level::TRACE => "trace",
        Level::DEBUG => "debug",
        Level::INFO => "info",
        Level::WARN => "warning",
        Level::ERROR => "error",
    }
}

/// Parses a JS-side log-level name.
/// Returns `None` for `"off"` or unrecognized strings.
fn parse_js_level_to_rust(level: &str) -> Option<Level> {
    match level {
        "trace" => Some(Level::TRACE),
        "debug" => Some(Level::DEBUG),
        "info" => Some(Level::INFO),
        "warning" => Some(Level::WARN),
        "error" => Some(Level::ERROR),
        _ => None,
    }
}

struct MessageVisitor {
    log_message: String,
}

impl MessageVisitor {
    fn new() -> Self {
        Self {
            log_message: String::new(),
        }
    }
}

// Collects all fields and values in a single log event into a single String, similarly to C++-rs driver
impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        if self.log_message.is_empty() {
            write!(self.log_message, "{field}: {value:?}").unwrap();
        } else {
            write!(self.log_message, ", {field}: {value:?}").unwrap();
        }
    }
}

/// A single global `Layer` that, on each event, iterates every registered
/// per-client callback and forwards the event data to those whose
/// `min_level` is permissive enough.
struct JsForwardingLayer;

impl<S: tracing::Subscriber> Layer<S> for JsForwardingLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let Some(lock) = CALLBACKS.get() else {
            return;
        };
        let callbacks = lock.read().unwrap();
        if callbacks.is_empty() {
            return;
        }

        let meta = event.metadata();
        let event_level = meta.level();

        // Quick pre-check: is *any* callback interested in this level?
        // Level ordering in tracing: TRACE > DEBUG > INFO > WARN > ERROR
        // (more verbose = greater).  An event passes if it is at most as
        // verbose as the callback's threshold, i.e. event_level <= min_level.
        if !callbacks.iter().any(|cb| *event_level <= cb.min_level) {
            return;
        }

        // At least one callback wants this event — extract the fields.
        let level_str = rust_level_to_js(event_level).to_owned();
        let target = meta.target().to_owned();

        let mut visitor = MessageVisitor::new();
        event.record(&mut visitor);

        for cb in callbacks.iter() {
            if *event_level <= cb.min_level {
                cb.callback.call(
                    FnArgs {
                        data: (
                            level_str.to_owned(),
                            target.to_owned(),
                            visitor.log_message.to_owned(),
                            "".to_owned(),
                        ),
                    },
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            }
        }
    }
}

/// Register a per-client logging callback.
///
/// Each call adds a **new** callback to the global registry, allowing
/// multiple `Client` instances to receive Rust driver log events
/// independently.
///
/// Returns a numeric `id` that must be passed to [`removeLogging`] when the
/// client shuts down, so the callback can be unregistered.
///
/// Returns `None` (`null` on the JS side) when `min_level` is `"off"` or
/// unrecognized — no callback is registered in that case.
#[napi]
pub fn setup_logging(callback: LogCallback, min_level: String) -> Option<i64> {
    let level = parse_js_level_to_rust(&min_level)?;

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

    let callbacks = get_or_init_callbacks();
    callbacks.write().unwrap().push(RegisteredCallback {
        id,
        callback,
        min_level: level,
    });

    Some(id as i64)
}

/// Unregister a previously-registered logging callback.
///
/// After this call the callback associated with `id` will no longer receive
/// any tracing events.  If `id` does not match any registered callback the
/// call is a silent no-op.
#[napi]
pub fn remove_logging(id: i64) {
    if let Some(lock) = CALLBACKS.get() {
        lock.write().unwrap().retain(|cb| cb.id != id as u64);
    }
}
