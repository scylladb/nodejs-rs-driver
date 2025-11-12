use napi::bindgen_prelude::BigInt;

use crate::errors::{ConvertedError, JsResult, js_error, with_custom_error_sync};
use crate::utils::bigint_to_i64;

#[napi]
pub fn tests_bigint_to_i64(value: BigInt, case_id: Option<i32>) -> JsResult<()> {
    with_custom_error_sync(|| {
        let case_id = match case_id {
            Some(case_id) => case_id,
            None => {
                return bigint_to_i64(value, "Overflow expected").map(|_| ());
            }
        };

        let expected = match case_id {
            0 => 0,
            1 => -1,
            2 => 5,
            3 => -5,
            4 => i64::MAX,
            5 => i64::MIN,
            6 => i64::MIN + 1,
            _ => 0,
        };

        let value = bigint_to_i64(value, "Overflow not expected");
        match value {
            Ok(v) => {
                if v == expected {
                    Ok(())
                } else {
                    Err(ConvertedError::from(js_error(format!(
                        "Got {v}, expected{expected}"
                    ))))
                }
            }
            Err(e) => Err(e),
        }
    })
}
