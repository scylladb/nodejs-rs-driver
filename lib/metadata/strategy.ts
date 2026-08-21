"use strict";

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
 *
 * This is a discriminated union: narrowing on {@link Strategy.kind} yields exactly the fields
 * that are meaningful for that variant, and no others. The four variant interfaces are generated
 * by napi-rs from the Rust structs that produce them.
 * @alias module:metadata~Strategy
 */
type Strategy =
    | rust.SimpleStrategy
    | rust.NetworkTopologyStrategy
    | rust.LocalStrategy
    | rust.OtherStrategy;

export { Strategy, StrategyKind };
