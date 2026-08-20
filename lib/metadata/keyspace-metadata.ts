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
    #wrapper: rust.KeyspaceWrapper;
    #strategy: Strategy | undefined;
    #tables: Record<string, TableMetadata> | undefined;
    #views: Record<string, MaterializedView> | undefined;
    #udts: Record<string, Udt> | undefined;

    /**
     * Creates a KeyspaceMetadata instance backed by a native keyspace wrapper.
     * @internal
     * @ignore
     */
    constructor(wrapper: rust.KeyspaceWrapper) {
        this.#wrapper = wrapper;
    }

    /**
     * Replication strategy used by the keyspace.
     */
    get strategy(): Strategy {
        let strategy = this.#strategy;
        if (!strategy) {
            // `KeyspaceWrapper.strategy`'s declared type in the generated `index.d.ts` points
            // back at `Strategy` in this very file - that circular reference confuses TS's
            // inference into widening it to `Strategy | undefined`, hence the explicit assertion.
            strategy = this.#wrapper.strategy as Strategy;
            this.#strategy = strategy;
        }
        return strategy;
    }

    /**
     * Whether the keyspace has durable writes enabled.
     */
    get durableWrites(): boolean {
        return this.#wrapper.durableWrites;
    }

    /**
     * Tables in the keyspace, keyed by table name.
     */
    get tables(): Record<string, TableMetadata> {
        let tables = this.#tables;
        if (!tables) {
            tables = this.#wrapper.tables;
            this.#tables = tables;
        }
        return tables;
    }

    /**
     * Materialized views in the keyspace, keyed by view name.
     */
    get views(): Record<string, MaterializedView> {
        let views = this.#views;
        if (!views) {
            views = this.#wrapper.views;
            this.#views = views;
        }
        return views;
    }

    /**
     * User-defined types in the keyspace, keyed by type name.
     */
    get udts(): Record<string, Udt> {
        let udts = this.#udts;
        if (!udts) {
            udts = this.#wrapper.udts;
            this.#udts = udts;
        }
        return udts;
    }

    /**
     * Creates a KeyspaceMetadata instance backed by a native keyspace wrapper.
     * @internal
     * @ignore
     */
    static fromRust(keyspaceWrapper: rust.KeyspaceWrapper): KeyspaceMetadata {
        return new KeyspaceMetadata(keyspaceWrapper);
    }
}

export { KeyspaceMetadata, Strategy, StrategyKind };

// Registers the Strategy constructor, so that Rust can construct fully-formed instances
// directly when reading cluster metadata. StrategyKind is a plain object of numeric
// constants, not a class, so unlike Strategy it has nothing to register: Rust and JS
// simply agree on the same numeric values
rust.registerStrategyCtor(Strategy);
