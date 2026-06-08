use tracing::Level;

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

#[cfg(test)]
mod tests {
    use super::*;

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
