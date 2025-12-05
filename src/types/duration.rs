use napi::bindgen_prelude::BigInt;
use scylla::value::CqlDuration;

use crate::{
    errors::{ConvertedResult, JsResult, with_custom_error_sync},
    utils::bigint_to_i64,
};

#[napi]
pub struct DurationWrapper {
    pub months: i32,
    pub days: i32,
    pub nanoseconds: i64,
}

#[napi]
impl DurationWrapper {
    #[napi]
    pub fn new(months: i32, days: i32, ns_bigint: BigInt) -> JsResult<DurationWrapper> {
        with_custom_error_sync(|| {
            ConvertedResult::Ok(DurationWrapper {
                months,
                days,
                nanoseconds: bigint_to_i64(ns_bigint, "Nanoseconds must not overflow i64")?,
            })
        })
    }

    #[napi]
    pub fn get_nanoseconds(&self) -> BigInt {
        let tmp: i128 = self.nanoseconds.into();
        let mut res: BigInt = BigInt::from(tmp.abs());
        res.sign_bit = self.nanoseconds < 0;
        res
    }
}

impl DurationWrapper {
    pub fn from_cql_duration(duration: CqlDuration) -> Self {
        DurationWrapper {
            months: duration.months,
            days: duration.days,
            nanoseconds: duration.nanoseconds,
        }
    }
    pub fn get_cql_duration(&self) -> CqlDuration {
        CqlDuration {
            months: self.months,
            days: self.days,
            nanoseconds: self.nanoseconds,
        }
    }
}
