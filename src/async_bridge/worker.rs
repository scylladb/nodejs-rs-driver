//! Code that runs on the Tokio worker threads.
//!
//! Nothing here calls Node-API. The only link back to the JavaScript thread
//! is the TSFN call in `CompletionQueue::push`.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use futures::FutureExt as _;
use napi::Env;
use napi::bindgen_prelude::ToNapiValue;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;

use super::js_thread;
use super::shared::{CompletionQueue, DeferredPtr, QueueEntry, SettleCallback};
use crate::errors::ConvertedResult;

/// The body of each task that `FutureRegistry::spawn` starts.
///
/// Awaits the future, boxes its result into a callback for the drain,
/// and pushes it to the queue. The box is allocated here, on the worker.
/// The JavaScript thread only calls and frees it.
pub(super) fn run_task<F, T>(
    future: F,
    deferred: DeferredPtr,
    queue: Arc<CompletionQueue>,
) -> impl Future<Output = ()>
where
    F: Future<Output = ConvertedResult<T>>,
    T: ToNapiValue + Send + 'static,
{
    future.map(move |result| {
        let settle: SettleCallback = Box::new(move |env: Env| {
            // SAFETY: Only `drain` calls this closure. It runs on the environment's
            // JavaScript thread, inside the TSFN callback, where `env` is valid.
            unsafe { js_thread::settle(env, deferred, result) }
        });
        queue.push(QueueEntry::Settle(settle));
    })
}

impl CompletionQueue {
    /// Called when a future completes.
    /// Only the first push after a drain calls the TSFN.
    /// Also called when a thread emits a `tracing` event.
    pub(super) fn push(&self, entry: QueueEntry) {
        self.completed.lock().unwrap().push(entry);
        if !self.signaled.swap(true, Ordering::AcqRel) {
            let guard = self.tsfn.lock().unwrap();
            if let Some(ref tsfn) = *guard {
                tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking);
            } // Else branches can happen only during shutdown
        }
    }
}
