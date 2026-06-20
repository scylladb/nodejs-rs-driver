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

use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_sync,
};

/// Shorthand for the NAPI callback type.
///
/// Generic parameters: `CalleeHandled = false`, `Weak = true` so that the
/// callback does not prevent the Node.js event-loop from exiting.
type LogCallback = ThreadsafeFunction<
    /* T: */ FnArgs<(String, String, String, String)>,
    /* Return: */ (),
    /* CallJsBackArgs: (level, target, message, furtherInfo) */
    FnArgs<(String, String, String, String)>,
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
        tracing::subscriber::set_global_default(subscriber).unwrap_or_else(|_| {
            // This will fail only if we try to call `set_global_default` in other place in the code.
            // Since we are under OnceLock here, we will not call this function here twice.
            // For this reason we can safely panic here.
            panic!("Double tracing initialization detected. This can happen in one of the two cases:\n\
             - Your code depends on another package that sets up the Rust logging. \
            If this is the case you need to either disable this driver logging, or disable the other package logging.\n\
             - This is a bug in the driver. If you believe this is a case, please submit a bug report: \
            https://github.com/scylladb/nodejs-rs-driver/issues/new. Include all used dependencies in the bug report.\n\
            ");
        });
        RwLock::new(Vec::new())
    })
}

/// Maps a Rust `tracing::Level` to the JS log-level strings.
pub(crate) fn rust_level_to_js(level: &Level) -> &'static str {
    match *level {
        Level::TRACE => "trace",
        Level::DEBUG => "debug",
        Level::INFO => "info",
        Level::WARN => "warning",
        Level::ERROR => "error",
    }
}

/// Parses a JS-side log-level name.
/// Note: "off" should be filtered at the JS side and should not be passed to Rust.
pub(crate) fn parse_js_level_to_rust(level: &str) -> Option<Level> {
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
    additional_fields: String,
}

impl MessageVisitor {
    fn new() -> Self {
        Self {
            log_message: String::new(),
            additional_fields: String::new(),
        }
    }
}

// Collects all fields and values in a single log event into a single String, similarly to CPP RS driver
impl Visit for MessageVisitor {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        // We filter out the `message` field since it's the main information; the remaining fields
        // are collected to mimic the JS `furtherInfo` field.
        if field.name() != "message" {
            if !self.additional_fields.is_empty() {
                write!(self.additional_fields, ", ").unwrap();
            }
            write!(self.additional_fields, "{field}: {value:?}").unwrap();
        } else {
            write!(self.log_message, "{value:?}").unwrap();
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
        let Ok(callbacks) = lock.read() else {
            return;
        };

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
        let level_str = rust_level_to_js(event_level);
        let target = meta.target();

        let mut visitor = MessageVisitor::new();
        event.record(&mut visitor);

        for cb in callbacks.iter() {
            if *event_level <= cb.min_level {
                cb.callback.call(
                    FnArgs {
                        data: (
                            level_str.to_owned(),
                            target.to_owned(),
                            visitor.log_message.clone(),
                            visitor.additional_fields.clone(),
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
#[napi(ts_return_type = "number")]
pub fn setup_logging(callback: LogCallback, min_level: String) -> JsResult<i64> {
    with_custom_error_sync(|| {
        let level = parse_js_level_to_rust(&min_level).ok_or(ConvertedError::from(
            make_js_error(format!("Unknown logging level: {min_level}")),
        ))?;

        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

        let callbacks = get_or_init_callbacks();
        callbacks.write()?.push(RegisteredCallback {
            id,
            callback,
            min_level: level,
        });

        ConvertedResult::Ok(id as i64)
    })
}

/// Unregister a previously-registered logging callback.
///
/// After this call the callback associated with `id` will no longer receive
/// any tracing events.  If `id` does not match any registered callback the
/// call is a silent no-op.
#[napi]
pub fn remove_logging(id: i64) {
    if let Some(lock) = CALLBACKS.get() {
        lock.write()
            .expect("Since we have use panic=abort, we will never have poisoned locks")
            .retain(|cb| cb.id != id as u64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tracing::field::Field;

    /// Helper to create a `Field` from a tracing event.
    fn with_fields<F: FnMut(&Field)>(field_name: &str, mut f: F) {
        use tracing::Callsite;
        use tracing::field::FieldSet;
        use tracing::metadata::Kind;

        static CALLSITE: tracing::callsite::DefaultCallsite =
            tracing::callsite::DefaultCallsite::new(&tracing::metadata::Metadata::new(
                "test",
                "test_target",
                Level::INFO,
                Some("test.rs"),
                Some(1),
                Some("test"),
                FieldSet::new(
                    &["message", "key1", "key2", "key3"],
                    tracing::callsite::Identifier(&CALLSITE),
                ),
                Kind::EVENT,
            ));

        let meta = CALLSITE.metadata();
        let field = meta.fields().field(field_name).unwrap();
        f(&field);
    }

    #[test]
    fn record_str_message_field() {
        let mut v = MessageVisitor::new();
        with_fields("message", |f| {
            v.record_str(f, "hello world");
        });
        assert_eq!(v.log_message, "\"hello world\"");
        assert_eq!(v.additional_fields, "");
    }

    #[test]
    fn message_and_extras_are_split() {
        let mut v = MessageVisitor::new();
        with_fields("message", |f| {
            v.record_str(f, "the message");
        });
        with_fields("key1", |f| {
            v.record_str(f, "str_val");
        });
        assert_eq!(v.log_message, "\"the message\"");
        assert_eq!(v.additional_fields, "key1: \"str_val\"");
    }

    #[test]
    fn mixed_str_and_debug_extras() {
        let mut v = MessageVisitor::new();
        with_fields("key1", |f| {
            v.record_str(f, "str_val");
        });
        with_fields("key2", |f| {
            v.record_debug(f, &42);
        });
        assert_eq!(v.log_message, "");
        assert_eq!(v.additional_fields, "key1: \"str_val\", key2: 42");
    }

    #[test]
    fn three_extras_comma_separated() {
        let mut v = MessageVisitor::new();
        with_fields("key1", |f| {
            v.record_str(f, "a");
        });
        with_fields("key2", |f| {
            v.record_str(f, "b");
        });
        with_fields("key3", |f| {
            v.record_str(f, "c");
        });
        assert_eq!(v.log_message, "");
        assert_eq!(v.additional_fields, "key1: \"a\", key2: \"b\", key3: \"c\"");
    }

    #[test]
    fn rust_level_to_js_mapping() {
        assert_eq!(rust_level_to_js(&Level::TRACE), "trace");
        assert_eq!(rust_level_to_js(&Level::DEBUG), "debug");
        assert_eq!(rust_level_to_js(&Level::INFO), "info");
        assert_eq!(rust_level_to_js(&Level::WARN), "warning");
        assert_eq!(rust_level_to_js(&Level::ERROR), "error");
    }

    #[test]
    fn parse_js_level_to_rust_valid() {
        assert_eq!(parse_js_level_to_rust("trace"), Some(Level::TRACE));
        assert_eq!(parse_js_level_to_rust("debug"), Some(Level::DEBUG));
        assert_eq!(parse_js_level_to_rust("info"), Some(Level::INFO));
        assert_eq!(parse_js_level_to_rust("warning"), Some(Level::WARN));
        assert_eq!(parse_js_level_to_rust("error"), Some(Level::ERROR));
        assert_eq!(parse_js_level_to_rust("some garbage"), None);
    }
}
