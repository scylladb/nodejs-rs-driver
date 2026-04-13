use std::collections::HashMap;

use crate::utils::to_napi_obj::{NamedMap, define_rust_to_js_convertible_object};

#[rustfmt::skip] // fmt splits each field definition into multiple lines
define_rust_to_js_convertible_object!(
pub struct Coord {
    x, x: i32,
    y, y: i32,
});

define_rust_to_js_convertible_object!(
pub enum Color where
    VariantName: kind,
{
    Red = 0,
    Green = 1,
    Custom {
        r, r: i32,
        g, g: i32,
        b, b: i32,
    } = 3,
});

/// Returns a plain struct produced by the macro.
/// Expected JS shape: `{ x: 10, y: 20 }`
#[napi]
pub fn tests_named_map_struct() -> Coord {
    Coord { x: 10, y: 20 }
}

/// Returns a `Color` enum variant produced by the macro.
/// Cases:
/// - `0` -> `{ kind: 0 }` (Red)
/// - `1` -> `{ kind: 1 }` (Green)
/// - `3` -> `{ kind: 3, r: 128, g: 0, b: 255 }` (Custom)
#[napi]
pub fn tests_named_map_enum(case: i32) -> Color {
    match case {
        0 => Color::Red,
        1 => Color::Green,
        3 => Color::Custom {
            r: 128,
            g: 0,
            b: 255,
        },
        _ => unimplemented!("Unknown test case"),
    }
}

/// Returns a `NamedMap` of i32 values (V == W, identity `Into`).
/// Expected JS shape: `{ a: 1, b: 2, c: 3 }`
#[napi]
pub fn tests_named_map_i32() -> NamedMap<String, i32> {
    let mut m = HashMap::new();
    m.insert("a".to_string(), 1i32);
    m.insert("b".to_string(), 2i32);
    m.insert("c".to_string(), 3i32);
    NamedMap::new(m)
}

/// Returns a `NamedMap` whose values are converted via `From` (`i32 -> Coord`).
/// Expected JS shape: `{ origin: { x: 0, y: 0 }, point: { x: 5, y: -3 } }`
#[napi]
pub fn tests_named_map_with_conversion() -> NamedMap<String, (i32, i32), Coord> {
    let mut m = HashMap::new();
    m.insert("origin".to_string(), (0i32, 0i32));
    m.insert("point".to_string(), (5i32, -3i32));
    NamedMap::new(m)
}

impl From<(i32, i32)> for Coord {
    fn from((x, y): (i32, i32)) -> Self {
        Coord { x, y }
    }
}
