// @ts-nocheck
"use strict";

// Used for JS doc
// eslint-disable-next-line no-unused-vars
const { ColumnInfo, convertComplexType } = require("../types/cql-utils");
const _rust = require("../../index");

/**
 * Describes a field of a user-defined type.
 * @alias module:metadata~UdtField
 */
class UdtField {
    /**
     * Name of the field.
     * @type {String}
     */
    name;

    /**
     * CQL type of the field.
     * @type {ColumnInfo}
     */
    type;

    /**
     * Constructs a UdtField instance.
     *
     * Instances of this class are constructed directly by the native driver when reading cluster metadata.
     * @param {String} name
     * @param {_rust.ComplexType} typ
     * @internal
     * @ignore
     */
    constructor(name, typ) {
        this.name = name;
        this.type = convertComplexType(typ);
    }
}

/**
 * Describes a user-defined type (UDT) in the cluster.
 * @alias module:metadata~UserDefinedType
 */
class UserDefinedType {
    /**
     * Name of the user-defined type (UDT).
     * UDT is composed of fields, each with a name and an optional value of its own type.
     * @type {String}
     */
    name;

    /**
     * Name of the keyspace the type belongs to.
     * @type {String}
     */
    keyspace;

    /**
     * Fields of the user-defined type.
     * @type {Array.<UdtField>}
     */
    fields;

    /**
     * Constructs a UserDefinedType instance.
     *
     * Instances of this class are constructed directly by the native driver when reading cluster metadata.
     * @param {String} name
     * @param {String} keyspace
     * @param {Array.<UdtField>} fields
     * @internal
     * @ignore
     */
    constructor(name, keyspace, fields) {
        this.name = name;
        this.keyspace = keyspace;
        this.fields = fields;
    }
}

module.exports = { UserDefinedType, UdtField };

// Registers the UdtField/UserDefinedType constructors with the native driver, so that Rust
// can construct fully-formed instances directly when reading cluster metadata.
_rust.registerUdtFieldCtor(UdtField);
_rust.registerUserDefinedTypeCtor(UserDefinedType);
