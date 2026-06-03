# ParameterWrapper

Parameter wrapper is used to pass parameters for all queries.
It can pass any CQL Value, null and unset values.
On the Rust side, the value is represented by:
`Option<MaybeUnset<CqlValue>>`
and on the JavaScript side it's represented by:
`[ComplexType, Value]` with the null being `[]` and unset being `[undefined]`.

The conversion from the user provided values to accepted format is done in `types/cql-utils.js`.

On the Rust side `requests/parameter_wrappers.rs` is responsible for value conversion
into format recognized by the Rust driver. It's done via the `FromNapiValue` trait.
The specific format containing both type and value is necessary to create a correct CQL Value,
without using [env](https://napi.rs/docs/compat-mode/concepts/env) in function.

As driver allows values to be provided in multiple formats:

- one of the predefined types,
- as a string representation of the type,
- as a pre-serialized byte array

which are converted into predefined type, before passing it to Rust.
It's possible to do this conversion also on the Rust side
(but it's necessary to check the performance impact of such change).
