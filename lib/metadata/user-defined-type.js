"use strict";

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
     * @type {type}
     */
    type;
}

/**
 * Describes a user-defined type (UDT) in the cluster.
 * @alias module:metadata~UserDefinedType
 */
class UserDefinedType {
    /**
     * Definition of a user-defined type (UDT).
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
}

module.exports = { UserDefinedType, UdtField };
