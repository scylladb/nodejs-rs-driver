use crate::errors::{ConvertedResult, JsResult, make_js_error, with_custom_error_sync};
use crate::utils::CharCounter;
use regex::Regex;
use scylla::value::CqlDate;
use std::sync::LazyLock;
use std::{
    cmp::max,
    fmt::{self, Write},
};
use thiserror::Error;

// Max and min date range of the Date class in JS.
const MAX_JS_DATE: i32 = 100_000_000;
const MIN_JS_DATE: i32 = -MAX_JS_DATE;

// Number of leap years up to 1970.
const LEAP_YEAR_1970: i32 = 477;

// Number of days to the beginning of each month.
const DAY_IN_MONTH: [i32; 12] = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

// based on https://stackoverflow.com/a/22061879
static DATE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^-?\d{1}\d*-(0?[1-9]|1[012])-(0?[1-9]|[12][0-9]|3[01])$")
        .expect("Invalid regex pattern")
});

/// LocalDateWrapper holds two data representations - value and day, month, year.
/// The class in JS has getters for both representations.
/// When a new LocalDateWrapper instance is created, the second representation is calculated.
#[napi]
pub struct LocalDateWrapper {
    /// wrapper for number of days from 01.01.1970
    pub value: i32,
    pub(crate) date: Option<Ymd>,
    /// value can be represented as Date class in JS
    pub in_date: bool,
}

#[napi]
impl LocalDateWrapper {
    /// Create a new object from the day, month and year.
    #[napi]
    pub fn new(day: i8, month: i8, year: i32) -> JsResult<LocalDateWrapper> {
        with_custom_error_sync(|| {
            let date = Ymd::new(year, month, day)?;

            let value = date.to_days();

            ConvertedResult::Ok(LocalDateWrapper {
                date: Some(date),
                value,
                in_date: (MIN_JS_DATE..=MAX_JS_DATE).contains(&value),
            })
        })
    }

    /// Create a new object from number of days since 01.01.1970.
    #[napi]
    pub fn new_day(value: i32) -> JsResult<LocalDateWrapper> {
        with_custom_error_sync(|| {
            let date = Ymd::from_days(value.into());
            ConvertedResult::Ok(LocalDateWrapper {
                value,
                date,
                in_date: (MIN_JS_DATE..=MAX_JS_DATE).contains(&value),
            })
        })
    }

    #[napi]
    pub fn get_date(&self) -> Option<Ymd> {
        self.date.clone()
    }

    #[napi(js_name = "toString")]
    pub fn to_format(&self) -> String {
        self.to_string()
    }

    pub fn get_cql_date(&self) -> CqlDate {
        CqlDate(((1 << 31) + self.value as i64) as u32)
    }

    pub fn from_cql_date(date: CqlDate) -> Self {
        let value = (date.0 as i64 - (1 << 31)) as i32;
        let date = Ymd::from_days(value.into());
        LocalDateWrapper {
            value,
            date,
            in_date: (MIN_JS_DATE..=MAX_JS_DATE).contains(&value),
        }
    }

    /// Returns the number of days since 01.01.1970 based on a String representing the date.
    #[napi]
    pub fn from_string(value: String) -> JsResult<i32> {
        with_custom_error_sync(|| {
            match value.chars().filter(|c| *c == '-').count() {
                d if d < 2 => match value.parse::<i32>() {
                    Ok(val) => ConvertedResult::Ok(val),
                    Err(_) => Err(DateInvalid::Format.into()),
                },
                2 | 3 => {
                    if !DATE_REGEX.is_match(&value) {
                        return Err(DateInvalid::Format.into());
                    }

                    let lambda = |s: String| -> Result<(i32, i8, i8), DateInvalid> {
                        // From checking the regex and from removing the first '-',
                        // it is clear that the date string has three '-'.
                        let date = s.strip_prefix('-').unwrap_or(&s);

                        let mut parts = date.split('-');
                        let y = parts.next().and_then(|q| q.parse::<i32>().ok());
                        let m = parts.next().and_then(|q| q.parse::<i8>().ok());
                        let d = parts.next().and_then(|q| q.parse::<i8>().ok());
                        let (Some(y), Some(m), Some(d)) = (y, m, d) else {
                            return Err(DateInvalid::Format);
                        };
                        Ok((if s.starts_with('-') { -1 } else { 1 } * y, m, d))
                    };

                    match lambda(value) {
                        Ok(s) => {
                            let date = Ymd {
                                year: s.0,
                                month: s.1,
                                day: s.2,
                            };
                            Ok(date.to_days())
                        }
                        Err(e) => Err(e.into()),
                    }
                }
                _ => Err(DateInvalid::Format.into()),
            }
        })
    }
}

impl fmt::Display for LocalDateWrapper {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.date {
            Some(date) => {
                if date.year < 0 {
                    write!(f, "-")?;
                }

                let mut counter = CharCounter::new();
                write!(&mut counter, "{}", date.year.abs())?;

                for _ in 0..(max(4 - counter.count() as i8, 0)) {
                    write!(f, "0")?;
                }
                write!(f, "{}", date.year.abs())?;

                if date.month < 10 {
                    write!(f, "-0{}", date.month)?;
                } else {
                    write!(f, "-{}", date.month)?;
                }
                if date.day < 10 {
                    write!(f, "-0{}", date.day)?;
                } else {
                    write!(f, "-{}", date.day)?;
                }
                Ok(())
            }
            None => {
                write!(f, "{}", self.value)
            }
        }
    }
}

/// Checks whether the year is leap year.
fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn number_leap_years(n: i32) -> i32 {
    n / 4 - n / 100 + n / 400
}

#[napi(object)]
#[derive(Clone, PartialEq, Debug)]
pub struct Ymd {
    pub year: i32,
    pub month: i8,
    pub day: i8,
}

impl Ymd {
    /// Create a new Ymd object
    fn new(year: i32, month: i8, day: i8) -> Result<Ymd, DateInvalid> {
        if !(1..=12).contains(&month) {
            return Err(DateInvalid::Month);
        }

        if !(day >= 1 && day <= Self::days_in_month(month, year)) {
            return Err(DateInvalid::Day);
        }

        Ok(Ymd { year, month, day })
    }

    /// Counts the number of days since 01.01.1970.
    fn to_days(&self) -> i32 {
        let mut total_days = 0;

        let number_day = DAY_IN_MONTH[self.month as usize - 1] // number of days from 1 January
            + if is_leap_year(self.year) && self.month > 2 {
                1                   // add 29 February
            }
            else { 0 }
            + self.day as i32
            - 1;

        if self.year >= 1970 {
            total_days += (self.year - 1970) * 365
                + number_leap_years(self.year - 1) - LEAP_YEAR_1970 // number of leap years
                + number_day;
        } else {
            total_days -= if is_leap_year(self.year) { 366 } else { 365 } - number_day;
            if self.year < 0 {
                total_days -= (1970 - self.year - 1) * 365
                    + number_leap_years((self.year + 1).abs())
                    + LEAP_YEAR_1970
                    + 1; // year 0 is leap year
            } else {
                total_days -= (1970 - self.year - 1) * 365 + LEAP_YEAR_1970
                    - number_leap_years(self.year + 1);
            }
        }
        total_days
    }

    /// Create a Ymd from the number of days since 01.01.1970.
    fn from_days(mut n: i64) -> Option<Self> {
        if !(MIN_JS_DATE..=MAX_JS_DATE).contains(&(n as i32)) {
            None
        } else {
            let mut year: i32 = 1970;
            while n.abs() >= 365 {
                // Find the number of years in n days.
                let k = (n / 365) as i32;
                // The year 0 is leap year.
                if year > 0 && year + k < 0 {
                    n += 1;
                } else if year < 0 && year + k > 0 {
                    n -= 1;
                }

                year += k;

                // Converting years into days and counting the number of leap years in this range.
                n -= (k * 365 - number_leap_years(year - k - 1) + number_leap_years(year - 1))
                    as i64;
            }

            if n < 0 {
                // If the remaining number of days is negative, change the year and count the complement.
                year -= 1;
                n += if is_leap_year(year) { 366 } else { 365 };
            }

            // Special handling of leap February.
            if is_leap_year(year) && n >= 60 {
                n -= 1;
            } else if is_leap_year(year) && n > 31 {
                return Some(Ymd {
                    year,
                    month: 2,
                    day: (n - 30) as i8,
                });
            }

            let q = DAY_IN_MONTH // Find month.
                .iter()
                .enumerate()
                .filter(|&(_, &x)| i64::from(x) <= n)
                .max_by_key(|&(_, &x)| x)
                .map(|(index, &_value)| index + 1)
                .unwrap();

            Some(Ymd {
                year,
                month: q as i8,
                day: (n - DAY_IN_MONTH[q - 1] as i64) as i8 + 1,
            })
        }
    }

    /// Returns the number of days in a month.
    fn days_in_month(month: i8, year: i32) -> i8 {
        match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 => {
                if is_leap_year(year) {
                    29
                } else {
                    28
                }
            }
            _ => 0,
        }
    }
}
#[derive(Error, Debug)]
enum DateInvalid {
    #[error("Invalid month")]
    Month,
    #[error("Invalid number of day")]
    Day,
    #[error("Invalid format of string")]
    Format,
}

impl From<DateInvalid> for napi::Error {
    fn from(value: DateInvalid) -> Self {
        make_js_error(value)
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_ymd_new() {
        // correct date
        assert!(Ymd::new(2025, 3, 1).is_ok());
        // invalid month
        let invalid_month_list: [Result<Ymd, DateInvalid>; 3] = [
            Ymd::new(2028, 30, 10),
            Ymd::new(0, 0, 0),
            Ymd::new(12, 15, 13),
        ];
        for record in invalid_month_list {
            assert!(record.is_err());
            assert!(matches!(record, Err(DateInvalid::Month)));
        }

        // invalid day
        let invalid_month_list: [Result<Ymd, DateInvalid>; 3] = [
            Ymd::new(2025, 2, 29),
            Ymd::new(0, 1, 0),
            Ymd::new(2137, 12, 37),
        ];
        for record in invalid_month_list {
            assert!(record.is_err());
            assert!(matches!(record, Err(DateInvalid::Day)));
        }
    }

    #[test]
    fn test_ymd_days() {
        // Values from previous logic in JS.
        let tests: [(Ymd, i32); 19] = [
            // simple examples
            (
                Ymd {
                    year: 1970,
                    month: 1,
                    day: 1,
                },
                0,
            ),
            (
                Ymd {
                    year: 2025,
                    month: 3,
                    day: 1,
                },
                20148,
            ),
            (
                Ymd {
                    year: 1975,
                    month: 11,
                    day: 8,
                },
                2137,
            ),
            (
                Ymd {
                    year: 150196,
                    month: 12,
                    day: 26,
                },
                54138795,
            ),
            (
                Ymd {
                    year: 2005,
                    month: 4,
                    day: 2,
                },
                12875,
            ),
            (
                Ymd {
                    year: 44444,
                    month: 3,
                    day: 1,
                },
                15513370,
            ),
            (
                Ymd {
                    year: 21,
                    month: 2,
                    day: 1,
                },
                -711826,
            ),
            // Negative number of days.
            (
                Ymd {
                    year: -3881,
                    month: 2,
                    day: 4,
                },
                -2137000,
            ),
            (
                Ymd {
                    year: 1969,
                    month: 12,
                    day: 31,
                },
                -1,
            ),
            (
                Ymd {
                    year: 0,
                    month: 1,
                    day: 1,
                },
                -719528,
            ),
            (
                Ymd {
                    year: 1968,
                    month: 9,
                    day: 27,
                },
                -461,
            ),
            (
                Ymd {
                    year: 1964,
                    month: 2,
                    day: 25,
                },
                -2137,
            ),
            (
                Ymd {
                    year: 404,
                    month: 5,
                    day: 3,
                },
                -571847,
            ),
            (
                Ymd {
                    year: 944,
                    month: 2,
                    day: 2,
                },
                -374707,
            ),
            // 29.02 before the epoch (negative and positive year) and after the epoch.
            (
                Ymd {
                    year: -4,
                    month: 2,
                    day: 29,
                },
                -720930,
            ),
            (
                Ymd {
                    year: 4,
                    month: 2,
                    day: 29,
                },
                -718008,
            ),
            (
                Ymd {
                    year: 404,
                    month: 2,
                    day: 29,
                },
                -571911,
            ),
            (
                Ymd {
                    year: 2044,
                    month: 2,
                    day: 29,
                },
                27087,
            ),
            (
                Ymd {
                    year: 2048,
                    month: 2,
                    day: 29,
                },
                28548,
            ),
        ];

        for test in tests {
            assert_eq!(test.0.to_days(), test.1);
            assert_eq!(Ymd::from_days(test.1.into()), Some(test.0));
        }
    }
}
