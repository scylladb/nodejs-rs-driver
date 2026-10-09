use crate::result::PageBuffer;
use bytes::Bytes;

#[napi(ts_return_type = "Buffer")]
pub fn tests_create_page_buffer(size: u32) -> PageBuffer {
    PageBuffer::from_bytes(Bytes::from(vec![0x5a; size as usize]))
}

#[napi]
pub fn tests_page_buffer_finalizations() -> u32 {
    crate::result::page_buffer_finalizations()
}
