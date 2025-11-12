use std::{
    error::Error,
    fmt::{self, Display},
};

use napi::{
    Env, JsValue, Status, Unknown,
    bindgen_prelude::{JsObjectValue, ToNapiValue},
};

/// Enum representing possible JavaScript error types.
/// Error, RangeError, ReferenceError, SyntaxError, TypeError
/// are native JavaScript error types and the rest are custom
/// Datastax driver error types.
pub enum ErrorType {
    ArgumentError,
    AuthenticationError,
    BusyConnectionError, // TODO: Add suport for fields of this error
    DriverError,
    DriverInternalError,
    NoHostAvailableError, // TODO: Add suport for fields of this error
    NotSupportedError,
    OperationTimedOutError, // TODO: Add suport for fields of this error
    ResponseError,          // TODO: Add suport for fields of this error
    Error,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
}

impl Display for ErrorType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ErrorType::ArgumentError => "ArgumentError",
            ErrorType::AuthenticationError => "AuthenticationError",
            ErrorType::BusyConnectionError => "BusyConnectionError",
            ErrorType::DriverError => "DriverError",
            ErrorType::DriverInternalError => "DriverInternalError",
            ErrorType::NoHostAvailableError => "NoHostAvailableError",
            ErrorType::NotSupportedError => "NotSupportedError",
            ErrorType::OperationTimedOutError => "OperationTimedOutError",
            ErrorType::ResponseError => "ResponseError",
            ErrorType::Error => "Error",
            ErrorType::RangeError => "RangeError",
            ErrorType::ReferenceError => "ReferenceError",
            ErrorType::SyntaxError => "SyntaxError",
            ErrorType::TypeError => "TypeError",
        })
    }
}

/// Custom result class, that supports extended errors.
/// Returning Error variants will result in throwing errors in JS.
///
/// You can either use Converted error, that supports some extra fields,
/// or you can add a new error type. Note that `with_custom_error_(sync/async)` functions
/// supports only ConvertedError conversion. Usage with different error requires manual handling.
/// This is important, because we cannot implement ToNapiValue for Result<T, E> directly,
/// And we cannot implement FromResidual for this class, as this is unstable feature.
///
/// When converting this class to JS value through ToNapiValue
/// cases will be handled in the following way:
/// - Ok(T): T::to_napi_value will be returned
/// - Error(ConvertedError): We will create napi::Error based on ConvertedError ToNapiValue trait and return Err(Error)
/// - NapiError(Error): Err(Error) will be returned
pub enum JsResult<T> {
    Ok(T),
    Error(ConvertedError),
    NapiError(napi::Error),
}

impl<T, E> From<Result<T, E>> for JsResult<T>
where
    E: Error,
{
    fn from(value: Result<T, E>) -> Self {
        match value {
            Ok(v) => JsResult::Ok(v),
            Err(e) => JsResult::Error(e.into()),
        }
    }
}

pub(crate) type ConvertedResult<T> = Result<T, ConvertedError>;

pub(crate) trait IntoConvertedResult {
    type Final;
    fn into_converted_result(self) -> ConvertedResult<Self::Final>;
}

impl<T, E> IntoConvertedResult for Result<T, E>
where
    ConvertedError: From<E>,
{
    type Final = T;
    fn into_converted_result(self) -> Result<T, ConvertedError> {
        self.map_err(ConvertedError::from)
    }
}

impl<T> From<Result<T, ConvertedError>> for JsResult<T> {
    fn from(value: Result<T, ConvertedError>) -> Self {
        match value {
            Ok(v) => JsResult::Ok(v),
            Err(e) => JsResult::Error(e),
        }
    }
}

impl<T> ToNapiValue for JsResult<T>
where
    T: ToNapiValue,
{
    /// # Safety
    ///
    /// Valid pointer to napi env must be provided
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        val: Self,
    ) -> napi::Result<napi::sys::napi_value> {
        match val {
            JsResult::Ok(val) => unsafe { T::to_napi_value(env, val) },
            JsResult::Error(error) => {
                // Safety: Valid pointer to napi env is provided by the caller
                let v = unsafe { ConvertedError::to_napi_value(env, error) }?;
                // Using unknown, that represents raw JS value allows us to create a custom JS error.
                // Any other construction methods restrict us to Errors with message and status only.
                // And we need to construct napi error, to make the napi properly handle the error throwing
                // for sync (by napi_throw) and async (by rejecting promises)
                // Safety: We are creating Unknown from valid napi env (validity ensured by the caller) and value (created just above)
                let err = unsafe { Unknown::from_raw_unchecked(env, v) };

                Err(err.into())
            }
            JsResult::NapiError(err) => Err(err),
        }
    }
}

/// This structure contains all the information we will use to create a custom JS error.
/// Creation of custom errors is done through ToNapiValue trait.
/// Values returned in this trait implementations are regular JS objects, that inherit from Error.
/// You still need to ensure the value will be "thrown" (or used to reject promise if in async fn)
/// This is done in the ToNapiValue of JsResult class
/// We convert all error to this struct, to allow for proper type checking in handling of this errors
pub struct ConvertedError {
    msg: String,
    name: &'static str,
}

impl<T> From<T> for ConvertedError
where
    T: Error,
{
    fn from(value: T) -> Self {
        ConvertedError {
            msg: value.to_string(),
            // We obtain the error class name.
            // Because this is never empty, we will never fail to get the last element
            // The split is done to cope with the fact that the type name
            // may return type with full package or without.
            //
            // Why using such obscure method?
            // Rust driver maintainer did not agree to add a code that would allow
            // systematic conversion from the errors as they are into their names and so on...
            //
            // For this reason, we also only expose the error class name,
            // and not the name of the specific kind, or the inner values of those errors.
            name: std::any::type_name::<T>()
                .rsplit(":")
                .next()
                .expect("Text after splitting should contain at least one element"),
        }
    }
}

impl ToNapiValue for ConvertedError {
    /// # Safety
    ///
    /// Valid pointer to napi env must be provided
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        val: Self,
    ) -> napi::Result<napi::sys::napi_value> {
        let env = Env::from_raw(env);
        let mut e = env.create_error(js_error(val.msg))?;

        e.set_named_property("name", val.name)?;

        Ok(e.raw())
    }
}

/// Allows to run a block of code that returns Result<T, ConvertedError>,
/// with automatic conversion to JsResult<T>. This allows to use the `?` operator,
/// while still returning JsResult<T> from the function.
/// Version for async functions
pub(crate) async fn with_custom_error_async<T, C, In>(code: C) -> JsResult<T>
where
    C: AsyncFnOnce() -> In,
    In: IntoConvertedResult<Final = T>,
{
    let c = code().await;
    c.into_converted_result().into()
}

/// Allows to run a block of code that returns Result<T, ConvertedError>,
/// with automatic conversion to JsResult<T>. This allows to use the `?` operator,
/// while still returning JsResult<T> from the function.
/// Version for sync functions
pub(crate) fn with_custom_error_sync<T, C, In>(code: C) -> JsResult<T>
where
    C: FnOnce() -> In,
    In: IntoConvertedResult<Final = T>,
{
    let c = code();
    c.into_converted_result().into()
}

/// Create napi::Error from a message
pub(crate) fn js_error<T: Display>(e: T) -> napi::Error {
    js_typed_error(e, ErrorType::Error)
}

/// Create napi::Error from a message and error type
pub(crate) fn js_typed_error<T: Display>(e: T, error_type: ErrorType) -> napi::Error {
    napi::Error::new(Status::GenericFailure, format!("{error_type}#{e}"))
}
