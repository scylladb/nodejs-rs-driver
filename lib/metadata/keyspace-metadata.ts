"use strict";

import { TableMetadata } from "./table-metadata";
import { MaterializedView } from "./materialized-view";
import { Udt } from "./user-defined-type";
import rust = require("../../index");

/**
 * Identifies the replication strategy variant.
 * @alias module:metadata~StrategyKind
 */
enum StrategyKind {
    /**
     * Deprecated in ScyllaDB.
     *
     * **Use only for a single datacenter and one rack.**
     *
     * Places the first replica on a node determined by the partitioner.
     * Additional replicas are placed on the next nodes clockwise in the ring
     * without considering topology (rack or datacenter location).
     */
    SimpleStrategy = 0,
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
    NetworkTopologyStrategy = 1,
    /**
     * Used for internal purposes, e.g. for system tables.
     */
    LocalStrategy = 2,
    /**
     * Unknown other strategy, which is not supported by the driver.
     */
    Other = 3,
}

/**
 * Describes the replication strategy used by a keyspace.
 * @alias module:metadata~Strategy
 */
class Strategy {
    /**
     * Identifies which strategy variant this is.
     */
    kind: StrategyKind;

    /**
     * Replication factor, i.e. how many replicas of each piece of data there are.
     * (only set when {@link kind} is {@link StrategyKind.SimpleStrategy}).
     */
    replicationFactor: number | null;

    /**
     * Replication factors of datacenters with given names, i.e. how many replicas of each piece
     * of data there are in each datacenter.
     * (only set when {@link kind} is {@link StrategyKind.NetworkTopologyStrategy}).
     */
    datacenterRepfactors: Record<string, number> | null;

    /**
     * Name of the strategy (only set when {@link kind} is {@link StrategyKind.Other}).
     */
    name: string | null;

    /**
     * Additional parameters of the strategy, which the driver does not understand.
     * (only set when {@link kind} is {@link StrategyKind.Other}).
     */
    data: Record<string, string> | null;

    /**
     * Constructs a Strategy instance.
     *
     * Instances of this class are constructed directly from the native code
     * when reading cluster metadata. Only the field(s) relevant to `kind`
     * are set; the rest are `null`.
     * @internal
     * @ignore
     */
    constructor(
        kind: StrategyKind,
        replicationFactor: number | null,
        datacenterRepfactors: Record<string, number> | null,
        name: string | null,
        data: Record<string, string> | null,
    ) {
        this.kind = kind;
        this.replicationFactor = replicationFactor ?? null;
        this.datacenterRepfactors = datacenterRepfactors ?? null;
        this.name = name ?? null;
        this.data = data ?? null;
    }
}

/**
 * Describes a keyspace in the cluster.
 *
 * This is a thin wrapper over the native `KeyspaceWrapper`: it holds the native wrapper
 * produced by the native layer and exposes its metadata through the driver's public API.
 * @alias module:metadata~KeyspaceMetadata
 */
class KeyspaceMetadata {
    /**
     * Native keyspace wrapper this instance delegates to.
     * @private
     */
    #strategy: Strategy | undefined;
    #tables: Record<string, TableMetadata> | undefined;
    #views: Record<string, MaterializedView> | undefined;
    #udts: Record<string, Udt> | undefined;

    /**
     * Creates a KeyspaceMetadata instance backed by a native keyspace wrapper.
     * @internal
     * @ignore
     */
    constructor(
        strategy: Strategy | undefined,
        tables: Record<string, TableMetadata> | undefined,
        views: Record<string, MaterializedView> | undefined,
        udts: Record<string, Udt> | undefined,
    ) {
        this.#strategy = strategy;
        this.#tables = tables;
        this.#views = views;
        this.#udts = udts;
    }
}

export { KeyspaceMetadata, Strategy, StrategyKind };

// Registers the Strategy constructor, so that Rust can construct fully-formed instances
// directly when reading cluster metadata. StrategyKind is a plain object of numeric
// constants, not a class, so unlike Strategy it has nothing to register: Rust and JS
// simply agree on the same numeric values
rust.registerStrategyCtor(Strategy);
