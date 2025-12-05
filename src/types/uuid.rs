use napi::{Error, Status, bindgen_prelude::Buffer, bindgen_prelude::BufferSlice};
use uuid::Uuid;

use crate::errors::{ConvertedError, JsResult, with_custom_error_sync};

#[napi]
pub struct UuidWrapper {
    uuid: Uuid,
}

#[napi]
impl UuidWrapper {
    #[napi]
    pub fn new(buffer: BufferSlice) -> JsResult<UuidWrapper> {
        with_custom_error_sync(|| match Uuid::from_slice(buffer.as_ref()) {
            Err(_) => Err(ConvertedError::from(Error::new(
                Status::InvalidArg,
                "Invalid uuid buffer",
            ))),
            Ok(uuid) => Ok(Self { uuid }),
        })
    }

    #[napi]
    pub fn get_buffer(&self) -> Buffer {
        Buffer::from(self.uuid.as_bytes().to_vec())
    }
}

impl UuidWrapper {
    pub fn from_cql_uuid(uuid: Uuid) -> Self {
        UuidWrapper { uuid }
    }
    pub fn get_cql_uuid(&self) -> Uuid {
        self.uuid
    }
}

#[napi]
pub fn get_random_uuid_v4() -> Buffer {
    Buffer::from(Uuid::new_v4().as_bytes().as_slice())
}
