use napi::bindgen_prelude::{Buffer, ToNapiValue};
use scylla::response::{PagingState, PagingStateResponse};

use crate::{
    errors::{JsResult, make_js_error, with_custom_error_sync},
    result::QueryResultWrapper,
};

#[napi]
pub struct PagingStateWrapper {
    pub(crate) inner: PagingState,
}

#[napi]
pub struct PagingStateResponseWrapper {
    inner: PagingStateResponse,
}

#[napi]
impl PagingStateWrapper {
    #[napi]
    pub fn from_buffer(value: Buffer) -> PagingStateWrapper {
        PagingStateWrapper {
            inner: PagingState::new_from_raw_bytes(&*value),
        }
    }

    #[napi]
    pub fn get_raw_page_state(&self) -> Buffer {
        self.inner
            .as_bytes_slice()
            .map_or(Buffer::default(), |e| (*(e.clone())).into())
    }
}

impl From<PagingStateResponse> for PagingStateResponseWrapper {
    fn from(value: PagingStateResponse) -> Self {
        PagingStateResponseWrapper { inner: value }
    }
}

/// Simple object that keeps the result of the current page result
/// and information about next page.
///
/// Instead of using this object, we could return tuple of values.
/// This would return the same object to the Node part of the program.
/// But, this can be only done in NAPI 3.0 which we are not using at the moment
pub struct PagingResult {
    pub(crate) paging_state: PagingStateResponseWrapper,
    pub(crate) result: QueryResultWrapper,
}

impl ToNapiValue for PagingResult {
    /// # Safety
    ///
    /// Valid pointer to napi env must be provided
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        val: Self,
    ) -> napi::Result<napi::sys::napi_value> {
        // Caller of this function ensures a valid pointer to napi env is provided
        unsafe {
            Vec::to_napi_value(
                env,
                vec![
                    PagingStateResponseWrapper::to_napi_value(env, val.paging_state),
                    QueryResultWrapper::to_napi_value(env, val.result),
                ],
            )
        }
    }
}

#[napi]
impl PagingStateResponseWrapper {
    /// Determines if the query has finished
    /// or it should be resumed with
    /// given PagingState in order to fetch next pages.
    #[napi]
    pub fn has_next_page(&self) -> bool {
        !self.inner.finished()
    }

    /// Get the next page of the given query, assuming there are pages left
    #[napi]
    pub fn next_page(&self) -> JsResult<PagingStateWrapper> {
        with_custom_error_sync(|| {
            Ok(PagingStateWrapper {
                inner: match &self.inner {
                    PagingStateResponse::HasMorePages { state } => state.clone(),
                    PagingStateResponse::NoMorePages => {
                        return Err(make_js_error("All pages transferred"));
                    }
                },
            })
        })
    }
}
