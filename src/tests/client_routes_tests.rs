//! Test-only helpers for the client routes bridging layer.
//!
//! The routing logic itself lives in the rust driver and is tested there. What
//! these helpers expose is the part this crate is responsible for: that JS
//! options are deserialized into the right rust configuration, that the right
//! session builder kind is selected, and that no option is lost on the way.

use crate::errors::{
    ConvertedError, ConvertedResult, JsResult, make_js_error, with_custom_error_sync,
};
use crate::session::config::{
    ConfiguredSessionBuilder, SessionOptions, configure_session_builder,
    convert_client_routes_config,
};

/// Reports which session builder the given options select: `"default"` or
/// `"clientRoutes"`. Rejects for configurations the bridge refuses, so the JS
/// side can assert on the message.
#[napi]
pub fn tests_session_builder_mode(options: SessionOptions) -> JsResult<String> {
    with_custom_error_sync(|| {
        let mode = match configure_session_builder(options)? {
            ConfiguredSessionBuilder::Default(_) => "default",
            ConfiguredSessionBuilder::ClientRoutes(_) => "clientRoutes",
        };
        ConvertedResult::Ok(mode.to_owned())
    })
}

/// Renders the rust `ClientRoutesConfig` that the given options convert into.
#[napi]
pub fn tests_describe_client_routes_config(options: SessionOptions) -> JsResult<String> {
    with_custom_error_sync(|| {
        let client_routes_config = options
            .client_routes_config
            .ok_or_else(|| ConvertedError::from(make_js_error("clientRoutesConfig was not set")))?;
        let converted = convert_client_routes_config(client_routes_config)?;
        ConvertedResult::Ok(format!("{converted:?}"))
    })
}
