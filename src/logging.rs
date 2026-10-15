use std::cell::{Cell, RefCell};
use std::fmt;
use std::ptr;
use std::rc::Rc;
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use napi::bindgen_prelude::{FnArgs, FunctionRef, JsValue, JsValuesTupleIntoVec};
use napi::{Env, sys};
use std::fmt::Write;
use tracing::Level;
use tracing::field::{Field, Visit};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::{Layer, Registry};

use crate::async_bridge;
use crate::errors::{ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error};

/// A JS log callback: `(level, target, message, furtherInfo) => void`.
type LogCallback = FunctionRef<FnArgs<(String, String, String, String)>, ()>;

/// A callback registered by one client, together with the minimum severity
/// level it is interested in.
struct RegisteredCallback {
    id: u64,
    /// `Rc`, so `deliver_log` can call it after it releases the borrow of
    /// `CALLBACKS`. The callback runs user JS, which can call `setupLogging`
    /// or `removeLogging`. They borrow `CALLBACKS` mutably, which would panic
    /// while `deliver_log` still holds a borrow.
    callback: Rc<LogCallback>,
    min_level: Level,
}

/// Monotonically increasing id counter for registered callbacks.
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

/// The most verbose `level_rank` of all registered callbacks.
/// Any thread reads it to skip events that no callback wants.
/// It is updated when a callback is added or removed.
static MAX_LEVEL: AtomicU8 = AtomicU8::new(0);

/// The levels of the callbacks of all environments, by id.
/// Only `MAX_LEVEL` is computed from it.
static LEVELS: Mutex<Vec<(u64, Level)>> = Mutex::new(Vec::new());

thread_local! {
    /// The callbacks of the clients of this thread's environment.
    /// Used only on JavaScript threads.
    static CALLBACKS: RefCell<Vec<RegisteredCallback>> = const { RefCell::new(Vec::new()) };

    /// Whether the env cleanup hook of this thread's environment is registered.
    static CLEANUP_REGISTERED: Cell<bool> = const { Cell::new(false) };
}

/// The rank of a level in `MAX_LEVEL`. 0 means "no callback".
/// A larger rank is more verbose.
fn level_rank(level: Level) -> u8 {
    match level {
        Level::ERROR => 1,
        Level::WARN => 2,
        Level::INFO => 3,
        Level::DEBUG => 4,
        Level::TRACE => 5,
    }
}

/// Changes `LEVELS` and recomputes `MAX_LEVEL` from it.
fn update_levels(change: impl FnOnce(&mut Vec<(u64, Level)>)) {
    let mut levels = LEVELS
        .lock()
        .expect("Since we have use panic=abort, we will never have poisoned locks");
    change(&mut levels);
    let max = levels
        .iter()
        .map(|(_, level)| level_rank(*level))
        .max()
        .unwrap_or(0);
    MAX_LEVEL.store(max, Ordering::Relaxed);
}

/// Set once the global tracing subscriber is installed.
static SUBSCRIBER_INSTALLED: OnceLock<()> = OnceLock::new();

/// Install the global tracing subscriber, the first time this is called.
fn install_subscriber() {
    SUBSCRIBER_INSTALLED.get_or_init(|| {
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
    });
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

/// A `tracing` event, formatted on the thread that emitted it.
/// It holds only plain data, so it can move to another thread.
pub(crate) struct LogEvent {
    level: Level,
    target: String,
    message: String,
    further_info: String,
}

impl LogEvent {
    fn from_event(event: &tracing::Event<'_>) -> Self {
        let meta = event.metadata();
        let mut visitor = MessageVisitor::new();
        event.record(&mut visitor);
        Self {
            level: *meta.level(),
            target: meta.target().to_owned(),
            message: visitor.log_message,
            further_info: visitor.additional_fields,
        }
    }

    /// The arguments of a JS log callback: `(level, target, message, furtherInfo)`.
    fn to_js_args(&self) -> (String, String, String, String) {
        (
            rust_level_to_js(&self.level).to_owned(),
            self.target.clone(),
            self.message.clone(),
            self.further_info.clone(),
        )
    }
}

/// Calls every callback of this environment that wants the event.
///
/// The drain of the async bridge calls this, on the JavaScript thread,
/// in the order of the queue.
pub(crate) fn deliver_log(env: Env, event: LogEvent) {
    // A callback can add or remove callbacks. So call them from a
    // snapshot, and hold no borrow while JavaScript runs.
    let targets: Vec<(u64, Rc<LogCallback>)> = CALLBACKS.with_borrow(|callbacks| {
        callbacks
            .iter()
            .filter(|cb| event.level <= cb.min_level)
            .map(|cb| (cb.id, Rc::clone(&cb.callback)))
            .collect()
    });

    for (id, callback) in targets {
        // An earlier callback in this drain may have removed this one.
        if !CALLBACKS.with_borrow(|callbacks| callbacks.iter().any(|cb| cb.id == id)) {
            continue;
        }
        let Ok(f) = callback.borrow_back(&env) else {
            // This fails only when the environment stops.
            // JavaScript cannot run then.
            continue;
        };
        call_log_callback(env, f.raw(), event.to_js_args());
    }
}

/// Calls one log callback.
///
/// If the callback throws, this function reports the original exception
/// as an uncaught exception. napi-rs does the same for a thread-safe
/// function.
///
/// This function does not use `Function::call`. When the callback throws,
/// `Function::call` converts the exception to a `napi::Error`.
/// This conversion runs JavaScript:
/// - It reads `cause` recursively. If `cause` is cyclic, the stack overflows.
/// - It converts the value to a string. For a thrown `Symbol`, this throws
///   a new exception, and the new exception stays pending. Then the next
///   Promise in this drain does not settle.
fn call_log_callback(env: Env, callback: sys::napi_value, args: (String, String, String, String)) {
    let raw_env = env.raw();
    let Ok(args) = FnArgs { data: args }.into_vec(raw_env) else {
        // This fails only when the environment stops.
        return;
    };

    let mut recv = ptr::null_mut();
    let mut ret = ptr::null_mut();
    // SAFETY: Env is valid on the JavaScript thread of this environment.
    // `callback` and `args` are values of this environment.
    // They stay valid in the current handle scope.
    let status = unsafe {
        sys::napi_get_undefined(raw_env, &mut recv);
        sys::napi_call_function(raw_env, recv, callback, args.len(), args.as_ptr(), &mut ret)
    };
    if status != sys::Status::napi_pending_exception {
        return;
    }

    // The callback threw. Clear the exception and report it as uncaught.
    // - Clear: while an exception is pending, N-API calls fail. Then the
    //   remaining Promises of this drain do not settle.
    // - Report: give the original thrown value to Node's uncaught
    //   exception handling.
    let mut exception = ptr::null_mut();
    // SAFETY: The same conditions as above apply.
    // After `worker.terminate()`, these calls can fail. Nothing can see
    // the error then. So this code ignores the status.
    unsafe {
        if sys::napi_get_and_clear_last_exception(raw_env, &mut exception) == sys::Status::napi_ok {
            sys::napi_fatal_exception(raw_env, exception);
        }
    }
}

/// A single global `Layer`. On each event, it queues the event for the
/// Node.js environment of the current thread. The queue is the one of the
/// async bridge. So an event that happens before a future completes
/// reaches JavaScript before the Promise settles.
struct JsForwardingLayer;

impl<S: tracing::Subscriber> Layer<S> for JsForwardingLayer {
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        // Quick pre-check: does *any* callback want this level?
        if level_rank(*event.metadata().level()) > MAX_LEVEL.load(Ordering::Relaxed) {
            return;
        }
        // The fields are extracted only if this thread has an environment.
        async_bridge::push_log(|| LogEvent::from_event(event));
    }
}

/// Removes the callbacks of this thread's environment. Runs at env cleanup.
fn clear_callbacks() {
    let removed = CALLBACKS.take();
    update_levels(|levels| levels.retain(|(id, _)| !removed.iter().any(|cb| cb.id == *id)));
}

/// Register a per-client logging callback.
///
/// Each call adds a **new** callback, allowing multiple `Client` instances
/// to receive Rust driver log events independently.
/// A callback receives only the events of its own Node.js environment
/// (the main thread or one worker thread).
///
/// Returns a numeric `id` that must be passed to [`removeLogging`] when the
/// client shuts down, so the callback can be unregistered.
#[napi(
    ts_args_type = "callback: (level: string, target: string, message: string, furtherInfo: string) => void, minLevel: string",
    ts_return_type = "number"
)]
pub fn setup_logging(env: Env, callback: LogCallback, min_level: String) -> JsResult<i64> {
    with_custom_error(|| {
        let level = parse_js_level_to_rust(&min_level).ok_or(ConvertedError::from(
            make_js_error(format!("Unknown logging level: {min_level}")),
        ))?;
        if !async_bridge::is_initialized(&env) {
            return Err(ConvertedError::from(make_js_error(
                "initAsyncBridge must be called before setupLogging",
            )));
        }

        if !CLEANUP_REGISTERED.replace(true) {
            env.add_env_cleanup_hook((), |_| clear_callbacks())?;
        }
        install_subscriber();

        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        CALLBACKS.with_borrow_mut(|callbacks| {
            callbacks.push(RegisteredCallback {
                id,
                callback: Rc::new(callback),
                min_level: level,
            })
        });
        update_levels(|levels| levels.push((id, level)));

        ConvertedResult::Ok(id as i64)
    })
}

/// Unregister a previously-registered logging callback.
///
/// After this call the callback associated with `id` will no longer receive
/// any tracing events, including the events already queued.
/// If `id` does not match any registered callback the call is a silent no-op.
#[napi]
pub fn remove_logging(id: i64) {
    let id = id as u64;
    CALLBACKS.with_borrow_mut(|callbacks| callbacks.retain(|cb| cb.id != id));
    update_levels(|levels| levels.retain(|(level_id, _)| *level_id != id));
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
