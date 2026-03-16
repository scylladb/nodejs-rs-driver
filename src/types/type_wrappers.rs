use std::borrow::Cow;

use napi::{
    Env, JsValue,
    bindgen_prelude::{JsObjectValue, Object, ToNapiValue},
};
use scylla::{cluster::metadata::NativeType, frame::response::result::ColumnType};

/// Represents CQL types with their corresponding numeric values from the CQL protocol.
#[derive(Clone)]
#[napi]
pub enum CqlType {
    Ascii = 0x0001,
    Boolean = 0x0004,
    Blob = 0x0003,
    Counter = 0x0005,
    Decimal = 0x0006,
    Date = 0x0011,
    Double = 0x0007,
    Duration = 0x0015,
    Empty = 0x0069,
    Float = 0x0008,
    Int = 0x0009,
    BigInt = 0x0002,
    Text = 0x000A,
    Timestamp = 0x000B,
    Varchar = 0x000D,
    Inet = 0x0010,
    List = 0x0020,
    Map = 0x0021,
    Set = 0x0022,
    UserDefinedType = 0x0030,
    SmallInt = 0x0013,
    TinyInt = 0x0014,
    Time = 0x0012,
    Timeuuid = 0x000F,
    Tuple = 0x0031,
    Uuid = 0x000C,
    Varint = 0x000E,
    Custom = 0x0000,
    // Vector is part of the Custom type. This value is assigning arbitrarily,
    // from outside of possible types values range. This is used only internally,
    // to avoid using enums with values in the Node-Api layer. It's later converted
    // to Custom type with customTypeName, on the JS side to match the expected type representation.
    Vector = 0x10001,
}

pub struct ComplexType<'a> {
    typ: Cow<'a, ColumnType<'a>>,
}

impl<'a> ComplexType<'a> {
    pub(crate) fn new_borrowed(value: &'a ColumnType<'a>) -> Self {
        ComplexType {
            typ: Cow::Borrowed(value),
        }
    }
}

impl ComplexType<'static> {
    pub(crate) fn new_owned(value: ColumnType<'static>) -> Self {
        ComplexType {
            typ: Cow::Owned(value),
        }
    }
}

impl ToNapiValue for ComplexType<'_> {
    unsafe fn to_napi_value(
        env: napi::sys::napi_env,
        val: Self,
    ) -> napi::Result<napi::sys::napi_value> {
        let env = Env::from_raw(env);
        let mut obj = Object::new(&env)?;

        let base_type_name = "baseType";
        let first_subtype_name = "subtype1";
        let second_subtype_name = "subtype2";

        match val.typ.as_ref() {
            ColumnType::Native(native_type) => {
                obj.set_named_property(
                    base_type_name,
                    match native_type {
                        NativeType::Ascii => CqlType::Ascii,
                        NativeType::Boolean => CqlType::Boolean,
                        NativeType::Blob => CqlType::Blob,
                        NativeType::Counter => CqlType::Counter,
                        NativeType::Date => CqlType::Date,
                        NativeType::Decimal => CqlType::Decimal,
                        NativeType::Double => CqlType::Double,
                        NativeType::Duration => CqlType::Duration,
                        NativeType::Float => CqlType::Float,
                        NativeType::Int => CqlType::Int,
                        NativeType::BigInt => CqlType::BigInt,
                        // Rust Driver unifies both VARCHAR and TEXT into NativeType::Text.
                        // CPP Driver, in accordance to the CQL protocol, has separate types for VARCHAR and TEXT.
                        // Even worse, Rust Driver even does not handle CQL TEXT correctly!
                        // It errors out on TEXT type...
                        // As the DBs (Cassandra and ScyllaDB) seem to send the VARCHAR type in the protocol,
                        // we will assume that the NativeType::Text is actually a VARCHAR type.
                        NativeType::Text => CqlType::Varchar,
                        NativeType::Timestamp => CqlType::Timestamp,
                        NativeType::Inet => CqlType::Inet,
                        NativeType::SmallInt => CqlType::SmallInt,
                        NativeType::TinyInt => CqlType::TinyInt,
                        NativeType::Time => CqlType::Time,
                        NativeType::Timeuuid => CqlType::Timeuuid,
                        NativeType::Uuid => CqlType::Uuid,
                        NativeType::Varint => CqlType::Varint,
                        other => {
                            unimplemented!("Missing implementation for CQL native type {:?}", other)
                        }
                    },
                )?;
            }
            ColumnType::Collection { frozen, typ } => {
                obj.set_named_property("frozen", frozen)?;
                let (name, typ1, typ2) = match typ {
                    scylla::cluster::metadata::CollectionType::List(column_type) => {
                        (CqlType::List, column_type, None)
                    }
                    scylla::cluster::metadata::CollectionType::Map(column_type, column_type1) => {
                        (CqlType::Map, column_type, Some(column_type1))
                    }
                    scylla::cluster::metadata::CollectionType::Set(column_type) => {
                        (CqlType::Set, column_type, None)
                    }
                    other => {
                        unimplemented!("Missing implementation for CQL Collection type {:?}", other)
                    }
                };
                obj.set_named_property(base_type_name, name)?;
                obj.set_named_property(first_subtype_name, ComplexType::new_borrowed(typ1))?;
                if let Some(typ2) = typ2 {
                    obj.set_named_property(second_subtype_name, ComplexType::new_borrowed(typ2))?;
                }
            }
            ColumnType::Vector { typ, dimensions } => {
                obj.set_named_property(base_type_name, CqlType::Vector)?;
                obj.set_named_property(first_subtype_name, ComplexType::new_borrowed(typ))?;
                obj.set_named_property("dimensions", dimensions)?;
            }
            ColumnType::UserDefinedType { frozen, definition } => {
                obj.set_named_property(base_type_name, CqlType::UserDefinedType)?;
                obj.set_named_property("frozen", frozen)?;
                obj.set_named_property("name", definition.name.as_ref())?;
                obj.set_named_property("keyspace", definition.keyspace.as_ref())?;
                obj.set_named_property(
                    "udt_types",
                    definition
                        .field_types
                        .iter()
                        .map(|(_, typ)| ComplexType::new_borrowed(typ))
                        .collect::<Vec<_>>(),
                )?;
                obj.set_named_property(
                    "udt_name",
                    definition
                        .field_types
                        .iter()
                        .map(|(name, _)| name.as_ref())
                        .collect::<Vec<_>>(),
                )?;
            }
            ColumnType::Tuple(column_types) => {
                obj.set_named_property(base_type_name, CqlType::Tuple)?;
                obj.set_named_property(
                    "subtypes",
                    column_types
                        .iter()
                        .map(ComplexType::new_borrowed)
                        .collect::<Vec<_>>(),
                )?;
            }
            other => unimplemented!("Missing implementation for CQL type {:?}", other),
        }

        Ok(obj.raw())
    }
}
