"use strict";

import utils = require("../utils");
import VersionNumber = require("./version-number");
import { Host } from "../host";

const v200 = VersionNumber.parse("2.0.0")!;
const v210 = VersionNumber.parse("2.1.0")!;
const v220 = VersionNumber.parse("2.2.0")!;
const v300 = VersionNumber.parse("3.0.0")!;
const v510 = VersionNumber.parse("5.1.0")!;
const v600 = VersionNumber.parse("6.0.0")!;

/**
 * Contains information for the different protocol versions supported by the driver.
 *
 * Strict equality operators to compare versions are allowed, other comparison operators are discouraged. Instead,
 * use a function that checks if a functionality is present on a certain version, for maintainability purposes.
 * @alias module:types~protocolVersion
 */
enum protocolVersion {
    /** Cassandra protocol v1, supported in Apache Cassandra 1.2-->2.2. */
    v1 = 0x01,
    /** Cassandra protocol v2, supported in Apache Cassandra 2.0-->2.2. */
    v2 = 0x02,
    /** Cassandra protocol v3, supported in Apache Cassandra 2.1-->3.x. */
    v3 = 0x03,
    /** Cassandra protocol v4, supported in Apache Cassandra 2.2-->3.x. */
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
    maxSupported = 0x42,
    /** Returns the lower protocol version that is supported by this driver. */
    minSupported = 0x01,
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
        return version <= 0x04 && version >= 0x01;
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
     * Determines whether the protocol supports partition key indexes in the `prepared` RESULT responses.
     * @internal
     * @ignore
     */
    export function supportsPreparedPartitionKey(version: number): boolean {
        return version >= protocolVersion.v4;
    }
    /**
     * Determines whether the protocol supports up to 4 strings (ie: change_type, target, keyspace and table) in the
     * schema change responses.
     * @internal
     * @ignore
     */
    export function supportsSchemaChangeFullMetadata(version: number): boolean {
        return version >= protocolVersion.v3;
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
     * Determines whether the protocol supports paging state and serial consistency parameters in QUERY and EXECUTE
     * requests.
     * @internal
     * @ignore
     */
    export function supportsPaging(version: number): boolean {
        return version >= protocolVersion.v2;
    }
    /**
     * Determines whether the protocol supports timestamps parameters in BATCH, QUERY and EXECUTE requests.
     * @internal
     * @ignore
     */
    export function supportsTimestamp(version: number): boolean {
        return version >= protocolVersion.v3;
    }
    /**
     * Determines whether the protocol supports named parameters in QUERY and EXECUTE requests.
     * @internal
     * @ignore
     */
    export function supportsNamedParameters(version: number): boolean {
        return version >= protocolVersion.v3;
    }
    /**
     * Determines whether the protocol supports unset parameters.
     * @internal
     * @ignore
     */
    export function supportsUnset(version: number): boolean {
        return version >= protocolVersion.v4;
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
     * Determines whether the protocol supports timestamp and serial consistency parameters in BATCH requests.
     * @internal
     * @ignore
     */
    export function uses2BytesStreamIds(version: number): boolean {
        return version >= protocolVersion.v3;
    }
    /**
     * Determines whether the collection length is encoded using 32 bits.
     * @internal
     * @ignore
     */
    export function uses4BytesCollectionLength(version: number): boolean {
        return version >= protocolVersion.v3;
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
     * Startup responses using protocol v4+ can be a SERVER_ERROR wrapping a ProtocolException, this method returns true
     * when is possible to receive such error.
     * @internal
     * @ignore
     */
    export function canStartupResponseErrorBeWrapped(version: number): boolean {
        return version >= protocolVersion.v4;
    }
    /**
     * Gets the first version number that is supported, lower than the one provided.
     * Returns zero when there isn't a lower supported version.
     * @internal
     * @ignore
     */
    export function getLowerSupported(version: number): number {
        if (version >= protocolVersion.v5) {
            return protocolVersion.v4;
        }
        if (version <= protocolVersion.v1) {
            return 0;
        }
        return version - 1;
    }

    /**
     * Computes the highest supported protocol version collectively by the given hosts.
     *
     * Considers the cassandra_version of the input hosts to determine what protocol versions
     * are supported and uses the highest common protocol version among them.
     *
     * If hosts >= C* 3.0 are detected, any hosts older than C* 2.1 will not be considered
     * as those cannot be connected to.  In general this will not be a problem as C* does
     * not support clusters with nodes that have versions that are more than one major
     * version away from each other.
     * @param connection Connection hosts were discovered from.
     * @param hosts The hosts to determine highest protocol version from.
     * @returns Highest supported protocol version among hosts.
     * @internal
     * @ignore
     */
    export function getHighestCommon(
        connection: any,
        hosts: Array<Host>,
    ): number {
        const log = connection.log
            ? connection.log.bind(connection)
            : utils.noop;
        let maxVersion = connection.protocolVersion;
        // whether or not protocol v3 is required (nodes detected that don't support < 3).
        let v3Requirement = false;
        // track the common protocol version >= v3 in case we encounter older versions.
        let maxVersionWith3OrMore = maxVersion;
        hosts.forEach((h: any) => {
            let dseVersion: VersionNumber | null = null;
            if (h.dseVersion) {
                // As of DSE 5.1, DSE has it's own specific protocol versions.  If we detect 5.1+
                // consider those protocol versions.
                dseVersion = VersionNumber.parse(h.dseVersion)!;
                log(
                    "verbose",
                    `Encountered host ${h.address} with dse version ${dseVersion}`,
                );
                if (dseVersion.compare(v510) >= 0) {
                    v3Requirement = true;
                    if (dseVersion.compare(v600) >= 0) {
                        maxVersion = Math.min(
                            protocolVersion.dseV2,
                            maxVersion,
                        );
                    } else {
                        maxVersion = Math.min(
                            protocolVersion.dseV1,
                            maxVersion,
                        );
                    }
                    maxVersionWith3OrMore = maxVersion;
                    return;
                }
                // If DSE < 5.1, we fall back on the cassandra protocol logic.
            }

            if (!h.cassandraVersion || h.cassandraVersion.length === 0) {
                log(
                    "warning",
                    "Encountered host " +
                        h.address +
                        " with no cassandra version," +
                        " skipping as part of protocol version evaluation",
                );
                return;
            }

            try {
                const cassandraVersion = VersionNumber.parse(
                    h.cassandraVersion,
                )!;
                if (!dseVersion) {
                    log(
                        "verbose",
                        "Encountered host " +
                            h.address +
                            " with cassandra version " +
                            cassandraVersion,
                    );
                }
                if (cassandraVersion.compare(v300) >= 0) {
                    // Anything 3.0.0+ has a max protocol version of V4 and requires at least V3.
                    v3Requirement = true;
                    maxVersion = Math.min(protocolVersion.v4, maxVersion);
                    maxVersionWith3OrMore = maxVersion;
                } else if (cassandraVersion.compare(v220) >= 0) {
                    // Cassandra 2.2.x has a max protocol version of V4.
                    maxVersion = Math.min(protocolVersion.v4, maxVersion);
                    maxVersionWith3OrMore = maxVersion;
                } else if (cassandraVersion.compare(v210) >= 0) {
                    // Cassandra 2.1.x has a max protocol version of V3.
                    maxVersion = Math.min(protocolVersion.v3, maxVersion);
                    maxVersionWith3OrMore = maxVersion;
                } else if (cassandraVersion.compare(v200) >= 0) {
                    // Cassandra 2.0.x has a max protocol version of V2.
                    maxVersion = Math.min(protocolVersion.v2, maxVersion);
                } else {
                    // Anything else is < 2.x and requires protocol version V1.
                    maxVersion = protocolVersion.v1;
                }
            } catch (e) {
                log(
                    "warning",
                    "Encountered host " +
                        h.address +
                        " with unparseable cassandra version " +
                        h.cassandraVersion +
                        " skipping as part of protocol version evaluation",
                );
            }
        });

        if (v3Requirement && maxVersion < protocolVersion.v3) {
            const addendum =
                ". This should not be possible as nodes within a cluster can't be separated by more than one major version";
            if (maxVersionWith3OrMore < protocolVersion.v3) {
                log(
                    "error",
                    "Detected hosts that require at least protocol version 0x3, but currently connected to " +
                        connection.address +
                        ":" +
                        connection.port +
                        " using protocol version 0x" +
                        maxVersionWith3OrMore +
                        ". Will not be able to connect to these hosts" +
                        addendum,
                );
            } else {
                log(
                    "error",
                    "Detected hosts with maximum protocol version of 0x" +
                        maxVersion.toString(16) +
                        " but there are some hosts that require at least version 0x3. Will not be able to connect to these older hosts" +
                        addendum,
                );
            }
            maxVersion = maxVersionWith3OrMore;
        }

        log(
            "verbose",
            "Resolved protocol version 0x" +
                maxVersion.toString(16) +
                " as the highest common protocol version among hosts",
        );
        return maxVersion;
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
