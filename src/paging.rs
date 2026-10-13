use napi::bindgen_prelude::ToNapiValue;
use scylla::response::PagingState;

use crate::{
    result::QueryResultWrapper, session::QueryExecutor, utils::to_napi_obj::CopyableBuffer,
};

/// Simple object that keeps the result of the current page result
/// and information about next page.
///
/// Instead of using this object, we could return tuple of values.
/// This would return the same object to the Node part of the program.
/// But, this can be only done in NAPI 3.0 which we are not using at the moment
pub struct PagingResult {
    pub(crate) paging_state: Option<PagingState>,
    pub(crate) result: QueryResultWrapper,
}

pub struct PagingResultWithExecutor {
    pub(crate) result: PagingResult,
    pub(crate) executor: QueryExecutor,
}

impl PagingResult {
    pub(crate) fn with_executor(self, executor: QueryExecutor) -> PagingResultWithExecutor {
        PagingResultWithExecutor {
            result: self,
            executor,
        }
    }
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
                    Option::to_napi_value(
                        env,
                        val.paging_state.as_ref().map(|state| {
                            CopyableBuffer::new(
                                state.as_bytes_slice().map_or(&[], |bytes| &bytes[..]),
                            )
                        }),
                    ),
                    QueryResultWrapper::to_napi_value(env, val.result),
                ],
            )
        }
    }
}

impl ToNapiValue for PagingResultWithExecutor {
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
                    Option::to_napi_value(
                        env,
                        val.result.paging_state.as_ref().map(|state| {
                            CopyableBuffer::new(
                                state.as_bytes_slice().map_or(&[], |bytes| &bytes[..]),
                            )
                        }),
                    ),
                    QueryResultWrapper::to_napi_value(env, val.result.result),
                    QueryExecutor::to_napi_value(env, val.executor),
                ],
            )
        }
    }
}
