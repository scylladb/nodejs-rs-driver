"use strict";

const { _TableMetadata } = require("./table-metadata");

/**
 * Identifies the replication strategy variant.
 * @readonly
 * @enum {number}
 * @alias module:metadata~StrategyKind
 */
const StrategyKind = {
    /**
     * Deprecated in ScyllaDB.
     *
     * **Use only for a single datacenter and one rack.**
     *
     * Places the first replica on a node determined by the partitioner.
     * Additional replicas are placed on the next nodes clockwise in the ring
     * without considering topology (rack or datacenter location).
     */
    SimpleStrategy: 0,
    /**
     * Use this strategy when you have (or plan to have) your cluster deployed across
     * multiple datacenters. This strategy specifies how many replicas you want in each
     * datacenter.
     *
     * `NetworkTopologyStrategy` places replicas in the same datacenter by walking the ring
     * clockwise until reaching the first node in another rack. It attempts to place replicas
     * on distinct racks because nodes in the same rack (or similar physical grouping) often
     * fail at the same time due to power, cooling, or network issues.
     */
    NetworkTopologyStrategy: 1,
    /**
     * Used for internal purposes, e.g. for system tables.
     */
    LocalStrategy: 2,
    /**
     * Unknown other strategy, which is not supported by the driver.
     */
    Other: 3,
};

StrategyKind.S;

/**
 * Describes the replication strategy used by a keyspace.
 * @alias module:metadata~Strategy
 */
class Strategy {
    /**
     * Identifies which strategy variant this is.
     * @type {StrategyKind}
     */
    kind;

    /**
     * Replication factor, i.e. how many replicas of each piece of data there are.
     * (only set when {@link kind} is {@link StrategyKind.SimpleStrategy}).
     * @type {number?}
     */
    replicationFactor;

    /**
     * Replication factors of datacenters with given names, i.e. how many replicas of each piece
     * of data there are in each datacenter.
     * (only set when {@link kind} is {@link StrategyKind.NetworkTopologyStrategy}).
     * @type {Object.<String, number>?}
     */
    datacenterRepfactors;

    /**
     * Name of the strategy (only set when {@link kind} is {@link StrategyKind.Other}).
     * @type {String?}
     */
    name;

    /**
     * Additional parameters of the strategy, which the driver does not understand.
     * (only set when {@link kind} is {@link StrategyKind.Other}).
     * @type {Object.<String, String>?}
     */
    data;
}

/**
 * Describes a keyspace in the cluster.
 * @alias module:metadata~KeyspaceMetadata
 */
class KeyspaceMetadata {
    /**
     * Replication strategy used by the keyspace.
     * @type {Strategy}
     */
    strategy;

    /**
     * Whether the keyspace has durable writes enabled.
     * @type {Boolean}
     */
    durableWrites;

    /**
     * Tables in the keyspace, keyed by table name.
     * @type {Object.<String, _TableMetadata>}
     */
    tables;

    /**
     * Materialized views in the keyspace, keyed by view name.
     * @type {Object.<String, Object>}
     */
    views;

    /**
     * User-defined types in the keyspace, keyed by type name.
     * @type {Object.<String, Object>}
     */
    userDefinedTypes;
}

module.exports = { KeyspaceMetadata, Strategy, StrategyKind };
