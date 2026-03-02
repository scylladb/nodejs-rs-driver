"use strict";

// Keyspace metadata, as present in DSx driver. Only firs 4 fields were provided to class as constructor arguments,
// with tokenToReplica being set there based on strategy value. The remaining fields were filled with default empty values
// While for now I didn't do a proper investigation into this matter, some of the fields (possibly all of them) 
// appear to never be filled with an actual data... 
class KeyspaceMetadata {
    /**
     * The name of the keyspace.
     * @type {String}
     */
    name;

    /**
     * Whether durable writes are enabled for this keyspace.
     * @type {Boolean}
     */
    // Present in system_schema.keyspaces
    durableWrites;

    /**
     * Name of the Strategy Class of this keyspace.
     * @type {String}
     */
    // Present in system_schema.keyspaces
    strategy;

    /**
     * @type {Object}
     */
    // Present in system_schema.keyspaces
    strategyOptions;

    /**
     * Whether this is a virtual keyspace.
     * @type {Boolean}
     */
    virtual;

    /**
     * A map of user-defined types in this keyspace, keyed by type name.
     * @type {Object}
     */
    udts;

    /**
     * A map of tables in this keyspace, keyed by table name.
     * @type {Object}
     */
    tables;

    /**
     * A map of user-defined functions in this keyspace, keyed by function name.
     * @type {Object}
     */
    functions;

    /**
     * A map of user-defined aggregates in this keyspace, keyed by aggregate name.
     * @type {Object}
     */
    aggregates;

    /**
     * A map of materialized views in this keyspace, keyed by view name.
     * @type {Object}
     */
    views;

    /**
     * A function that maps tokens to replica hosts for this keyspace,
     * based on its replication strategy.
     * @type {Function}
     */
    tokenToReplica;
}

module.exports = KeyspaceMetadata;
