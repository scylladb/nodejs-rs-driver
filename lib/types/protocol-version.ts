"use strict";

/**
 * Contains information for the different protocol versions supported by the driver.
 *
 * Strict equality operators to compare versions are allowed, other comparison operators are discouraged. Instead,
 * use a function that checks if a functionality is present on a certain version, for maintainability purposes.
 * @alias module:types~protocolVersion
 */
enum protocolVersion {
    /**
     * Cassandra protocol v1, supported in Apache Cassandra 1.2-->2.2.
     * Not supported by the driver.
     */
    v1 = 0x01,
    /**
     * Cassandra protocol v2, supported in Apache Cassandra 2.0-->2.2.
     * Not supported by the driver.
     */
    v2 = 0x02,
    /**
     * Cassandra protocol v3, supported in Apache Cassandra 2.1-->3.x.
     * Not supported by the driver.
     */
    v3 = 0x03,
    /** Cassandra protocol v4, supported in Apache Cassandra 2.2-->3.x and ScyllaDB. */
    v4 = 0x04,
    /**
     * Cassandra protocol v5, in beta from Apache Cassandra 3.x+. Currently not supported by the
     * driver.
     */
    v5 = 0x05,
    v6 = 0x06,
    /** DataStax Enterprise protocol v1, DSE 5.1+ */
    dseV1 = 0x41,
    /** DataStax Enterprise protocol v2, DSE 6.0+ */
    dseV2 = 0x42,
    /** Returns the higher protocol version that is supported by this driver. */
    maxSupported = 0x04,
    /** Returns the lower protocol version that is supported by this driver. */
    minSupported = 0x04,
}

/**
 * The functions of the protocol version module are merged into the enum, which
 * is what the module exported before it was converted to TypeScript.
 */
namespace protocolVersion {
    /**
     * Returns true if the protocol version represents a version of Cassandra
     * supported by this driver, false otherwise
     * @internal
     * @ignore
     */
    export function isSupportedCassandra(version: number): boolean {
        return version === protocolVersion.v4;
    }
    /**
     * Determines whether the protocol version is supported by this driver.
     * @ignore
     */
    export function isSupported(version: number): boolean {
        return protocolVersion.isSupportedCassandra(version);
    }

    /**
     * Determines whether the protocol includes flags for PREPARE messages.
     * @internal
     * @ignore
     */
    export function supportsPrepareFlags(version: number): boolean {
        return version === protocolVersion.dseV2;
    }
    /**
     * Determines whether the protocol supports sending the keyspace as part of PREPARE, QUERY, EXECUTE, and BATCH.
     * @internal
     * @ignore
     */
    export function supportsKeyspaceInRequest(version: number): boolean {
        return version === protocolVersion.dseV2;
    }
    /**
     * Determines whether the protocol supports result_metadata_id on `prepared` response and
     * and `execute` request.
     * @internal
     * @ignore
     */
    export function supportsResultMetadataId(version: number): boolean {
        return version === protocolVersion.dseV2;
    }
    /**
     * Determines whether the protocol supports continuous paging.
     * @internal
     * @ignore
     */
    export function supportsContinuousPaging(version: number): boolean {
        return false;
    }
    /**
     * Determines whether the protocol provides a reason map for read and write failure errors.
     * @internal
     * @ignore
     */
    export function supportsFailureReasonMap(version: number): boolean {
        return version >= protocolVersion.v5;
    }
    /**
     * Determines whether the QUERY, EXECUTE and BATCH flags are encoded using 32 bits.
     * @internal
     * @ignore
     */
    export function uses4BytesQueryFlags(version: number): boolean {
        return false;
    }

    /**
     * Determines if the protocol is a BETA version of the protocol.
     * @internal
     * @ignore
     */
    export function isBeta(version: number): boolean {
        return version === protocolVersion.v5;
    }
}

export = protocolVersion;
