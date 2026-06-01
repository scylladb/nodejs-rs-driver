# Errors

Napi-rs provides only a way to throw a JavaScript `Error` object.
Both DataStax and ScyllaDB drivers utilize multiple error classes to represent different issues.

## Errors in the DataStax driver

The DataStax driver utilizes error classes native to Node.js:

- `Error`,
- `TypeError`,
- `RangeError`,
- `ReferenceError`,
- `SyntaxError`,

custom error classes without additional arguments:

- `ArgumentError`,
- `AuthenticationError`,
- `DriverError`,
- `DriverInternalError`,
- `NotSupportedError`,

and custom error classes with additional arguments:

- `BusyConnectionError`,
- `NoHostAvailableError`,
- `OperationTimedOutError`,
- `ResponseError`.

Some of the errors arguments would be easy to pass by adding logic to the function implemented in
[#118](https://github.com/scylladb-zpp-2024-javascript-driver/scylladb-javascript-driver/pull/118),
but some of them are not easy to pass and even not easily available in the Rust driver.
For example, `NoHostAvailableError` has `innerErrors` parameter,
which is an object map containing the error message for each host.
This is available in the Rust driver only when using query execution history,
otherwise only the error for the last host is available.

## Errors in the ScyllaDB driver

The ScyllaDB driver has multiple custom error classes that can be found in `scylla/src/error.rs` file.
Some types of errors are enums, nesting more specific errors inside.

## Comparison

There are multiple errors in ScyllaDB driver that cannot be easily mapped to the DataStax driver errors.
Some of them are only relevant to ScyllaDB, because of different database and driver designs.
In the DataStax driver, the errors are more generic
and most of them are classified under `ResponseError`
with `code` parameter used to identify the nature of the error
(a list of error codes can be found in `lib/types/index.js` file).

## Possible solutions

### 1. Use the DataStax driver errors

Use the old architecture of the DataStax driver and throw existing errors.
Adding support for passing additional parameters of the errors would need to be implemented.
All Rust errors would need to be mapped, possibly losing some of the information
or encountering an issue that two cases are treated as the same error in the Rust driver
but different errors in the DataStax driver.
However, this would keep the interface closer to the DataStax driver
if some users are expecting specific error types.

### 2. Use the ScyllaDB driver errors

Use the ScyllaDB driver errors and throw them.
This would require implementing all of the error classes in JavaScript,
taking into account the fact that some of them are enums (probably by using class inheritance).
This would also need some work to pass the parameters of the errors.
This approach would lose less information about the errors and add support for ScyllaDB specific errors.
However, this would make the interface of possible errors different from the DataStax driver,
resulting in users needing to reimplement some of the error handling logic -
especially if they are testing for specific error types.
