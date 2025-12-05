pub mod from_napi_obj;
pub mod to_napi_obj;

use crate::errors::{ConvertedError, ConvertedResult, make_js_error};
use napi::bindgen_prelude::BigInt;
use std::fmt::{self, Display};

/// Convert napi bigint to i64. Returns napi::Error if value doesn't fit in i64.
pub(crate) fn bigint_to_i64(value: BigInt, error_msg: impl Display) -> ConvertedResult<i64> {
    // Currently BigInt.get_i64() doesn't work as intended, so for now convert it manually
    if value.words.len() != 1 || value.words[0] > i64::MAX as u64 {
        if value.sign_bit && value.words.first().unwrap_or(&0) == &i64::MIN.unsigned_abs() {
            return Ok(i64::MIN);
        }
        return Err(ConvertedError::from(make_js_error(error_msg)));
    }
    Ok(value.words[0] as i64 * if value.sign_bit { -1 } else { 1 })
}

#[derive(Default)]
pub struct CharCounter {
    count: usize,
}

impl CharCounter {
    pub fn new() -> Self {
        CharCounter { count: 0 }
    }

    pub fn count(self) -> usize {
        self.count
    }
}

impl fmt::Write for CharCounter {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.count = s.len();
        Ok(())
    }
}
