use napi::bindgen_prelude::create_custom_tokio_runtime;

#[macro_use]
extern crate napi_derive;

// Link other files
pub mod errors;
pub mod logging;
pub mod metadata;
pub mod options;
pub mod paging;
pub mod requests;
pub mod result;
pub mod session;
pub mod tests;
pub mod types;
pub mod utils;

#[napi_derive::module_init]
fn init() {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap();
    create_custom_tokio_runtime(rt);
}
