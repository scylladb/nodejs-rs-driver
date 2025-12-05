use crate::errors::{ConvertedError, JsResult, make_js_error};

#[napi]
pub fn tests_return_js_result(kind: i32) -> JsResult<i32> {
    match kind {
        1 => JsResult::Ok(1),
        2 => JsResult::Error(scylla::errors::BadKeyspaceName::Empty.into()),
        3 => JsResult::NapiError(make_js_error("Napi-error")),
        _ => unimplemented!("Unexpected test kind"),
    }
}

#[napi]
pub async fn tests_return_js_result_async(kind: i32) -> JsResult<i32> {
    tests_return_js_result(kind)
}

#[napi]
pub fn tests_return_converted_error() -> ConvertedError {
    scylla::errors::BadKeyspaceName::Empty.into()
}
