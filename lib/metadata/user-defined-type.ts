"use strict";

import { ColumnInfo, convertComplexType } from "../types/cql-utils";
import rust = require("../../index");

/**
 * Describes a field of a user-defined type.
 * @alias module:metadata~UdtField
 */
class UdtField {
    /**
     * Name of the field.
     */
    name: string;

    /**
     * CQL type of the field.
     */
    type: ColumnInfo;

    /**
     * Constructs a UdtField instance.
     *
     * Instances of this class are constructed directly from the native code when reading cluster metadata.
     * @internal
     * @ignore
     */
    constructor(name: string, typ: rust.ComplexType) {
        this.name = name;
        this.type = convertComplexType(typ);
    }
}

/**
 * Describes a user-defined type (UDT) in the cluster.
 * @alias module:metadata~Udt
 */
class Udt {
    /**
     * Name of the user-defined type (UDT).
     * UDT is composed of fields, each with a name and an optional value of its own type.
     */
    name: string;

    /**
     * Name of the keyspace the type belongs to.
     */
    keyspace: string;

    /**
     * Fields of the user-defined type.
     */
    fields: UdtField[];

    /**
     * Constructs a UserDefinedType instance.
     *
     * Instances of this class are constructed directly from the native code when reading cluster metadata.
     * @internal
     * @ignore
     */
    constructor(name: string, keyspace: string, fields: UdtField[]) {
        this.name = name;
        this.keyspace = keyspace;
        this.fields = fields;
    }
}

export { Udt, UdtField };

// Registers the UdtField/Udt constructors, so that Rust can construct fully-formed
// instances directly when reading cluster metadata.
rust.registerUdtFieldCtor(UdtField);
rust.registerUdtCtor(Udt);
