//! Code that runs on the Tokio worker threads.
//!
//! Nothing here calls Node-API. The only link back to the JavaScript thread
//! is a TSFN notification.

use std::future::Future;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use futures::FutureExt as _;
use napi::bindgen_prelude::ToNapiValue;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::{Env, Status};

use super::js_thread;
use super::shared::{CompletionQueue, DeferredPtr, SettleCallback};
use crate::errors::ConvertedResult;

/// The body of each task that `FutureRegistry::spawn` starts.
///
/// Awaits the future and delivers its result through the batch queue.
/// The completion callback is allocated here, on the worker.
/// Only the JavaScript thread calls it; failed sends or shutdown can drop it.
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
            // SAFETY: The drain invokes this closure on
            // the originating JavaScript thread inside its TSFN callback.
            unsafe { js_thread::settle(env, deferred, result) }
        });
        queue.push(settle);
    })
}

impl CompletionQueue {
    /// Reschedule a bounded drain, retaining shutdown and failed-send cleanup.
    /// Runs on the JavaScript thread after retaining the unfinished snapshot.
    pub(super) fn signal(&self) {
        // A worker commonly queued the next notification while JS settled the
        // snapshot. Avoid competing with that worker for the TSFN lock again.
        if self.signaled.load(Ordering::Acquire) {
            return;
        }
        let guard = self.tsfn.lock().unwrap();
        let Some(tsfn) = guard.as_ref() else {
            return;
        };
        let discarded = if !self.signaled.swap(true, Ordering::AcqRel)
            && tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking) != Status::Ok
        {
            self.signaled.store(false, Ordering::Release);
            std::mem::take(&mut *self.completed.lock().unwrap())
        } else {
            Default::default()
        };
        drop(guard);
        drop(discarded);
    }

    /// Called when a future completes.
    /// Only the first push after a drain calls the TSFN.
    fn push(&self, settle: SettleCallback) {
        // Serialize enqueue and send with teardown. No worker can leave a
        // callback in storage after shutdown has emptied it.
        let guard = self.tsfn.lock().unwrap();
        let Some(tsfn) = guard.as_ref() else {
            drop(guard);
            drop(settle);
            return;
        };
        self.completed.lock().unwrap().push(settle);
        let discarded = if !self.signaled.swap(true, Ordering::AcqRel)
            && tsfn.call((), ThreadsafeFunctionCallMode::NonBlocking) != Status::Ok
        {
            self.signaled.store(false, Ordering::Release);
            std::mem::take(&mut *self.completed.lock().unwrap())
        } else {
            Default::default()
        };
        drop(guard);
        drop(discarded);
    }
}
