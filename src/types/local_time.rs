use crate::errors::{ConvertedError, ConvertedResult, JsResult, js_error, with_custom_error_sync};
use crate::utils::{CharCounter, bigint_to_i64};
use napi::bindgen_prelude::BigInt;
use scylla::value::CqlTime;
use std::fmt::{self, Write};
use std::num::ParseIntError;

const NANO_SEC_IN_SEC: i64 = 1000000000;
const MILLIS_SEC_IN_HOUR: i64 = 3_600_000;
const MILLIS_SEC_IN_MIN: i64 = 60_000;
const MILLIS_SEC_IN_SEC: i64 = 1000;
const NANO_SEC_IN_MILLIS: i64 = 1_000_000;

#[napi]
pub struct LocalTimeWrapper {
    pub(crate) value: BigInt,
    pub hour: i64,
    pub minute: i64,
    pub second: i64,
    pub nanosecond: i64,
    ns_value: i64,
}

#[napi]
impl LocalTimeWrapper {
    fn convert_to_object(ns_value: i64) -> Self {
        let mut second: i64 = ns_value / NANO_SEC_IN_SEC;
        let nanosecond: i64 = ns_value - (second * NANO_SEC_IN_SEC);

        let mut minute = second / 60;
        let hour = minute / 60;

        second %= 60;
        minute %= 60;

        LocalTimeWrapper {
            value: BigInt::from(ns_value),
            hour,
            minute,
            second,
            nanosecond,
            ns_value,
        }
    }

    #[napi]
    pub fn get_value(&self) -> BigInt {
        self.value.clone()
    }

    #[napi]
    pub fn new(total_nanoseconds: BigInt) -> JsResult<LocalTimeWrapper> {
        with_custom_error_sync(|| {
            let ns_value = bigint_to_i64(total_nanoseconds, "Nanoseconds must not overflow i64")?;

            ConvertedResult::Ok(Self::convert_to_object(ns_value))
        })
    }

    /// format: hh:MM:ss.ns
    #[napi(js_name = "toString")]
    pub fn to_format(&self) -> String {
        self.to_string()
    }

    #[napi]
    pub fn from_string(s: String) -> JsResult<BigInt> {
        with_custom_error_sync(|| {
            let lambda = |s: String| -> Result<i64, ParseIntError> {
                let parts: Vec<&str> = s.split(':').collect();
                let mut millis: i64 = 0;

                millis += parts[0].parse::<i64>()? * MILLIS_SEC_IN_HOUR;
                millis += parts[1].parse::<i64>()? * MILLIS_SEC_IN_MIN;
                let mut nanos = 0;
                if parts.len() == 3 {
                    let sec_parts: Vec<&str> = parts[2].split('.').collect();
                    millis += sec_parts[0].parse::<i64>()? * MILLIS_SEC_IN_SEC;
                    if sec_parts.len() == 2 {
                        let n = 9 - sec_parts[1].to_string().chars().count() as u32;
                        nanos += sec_parts[1].parse::<i64>()? * i64::pow(10, n);
                    }
                }
                Ok(millis * NANO_SEC_IN_MILLIS + nanos)
            };

            match lambda(s) {
                Ok(x) => Ok(BigInt::from(x)),
                Err(_) => Err(ConvertedError::from(js_error(
                    "Conversion to String failed",
                ))),
            }
        })
    }

    pub fn get_cql_time(&self) -> CqlTime {
        CqlTime(self.ns_value)
    }

    pub fn from_cql_time(time: CqlTime) -> Self {
        Self::convert_to_object(time.0)
    }
}

impl fmt::Display for LocalTimeWrapper {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.hour < 10 {
            write!(f, "0{}:", self.hour)?;
        } else {
            write!(f, "{}:", self.hour)?;
        }
        if self.minute < 10 {
            write!(f, "0{}:", self.minute)?;
        } else {
            write!(f, "{}:", self.minute)?;
        }
        if self.second < 10 {
            write!(f, "0{}", self.second)?;
        } else {
            write!(f, "{}", self.second)?;
        }
        if self.nanosecond > 0 {
            let mut zeros = CharCounter::new();
            write!(&mut zeros, "{}", self.nanosecond)?;
            let mut nanos = self.nanosecond;
            while nanos % 10 == 0 {
                nanos /= 10;
            }
            write!(f, ".")?;
            for _ in 0..(9 - zeros.count()) {
                write!(f, "0")?;
            }
            write!(f, "{nanos}")?;
        }

        Ok(())
    }
}
