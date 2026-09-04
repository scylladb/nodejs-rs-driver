"use strict";

import events = require("events");
import net = require("node:net");

// TODO: remove once `lib/token.js` is converted to typescript.
// @ts-ignore
import { Token } from "./token";
import Uuid = require("./types/uuid");
import rust = require("../index");

/**
 * Returns the string representation of a given socket address.
 */
function socketAddressToString(address: net.SocketAddress): string {
    return address.family === "ipv6"
        ? `[${address.address}]:${address.port}`
        : `${address.address}:${address.port}`;
}

/**
 * Derives the hex string representation of a host id from a host id's raw bytes.
 */
function hostIdToString(buffer: Buffer): string {
    return buffer.toString("hex");
}

/**
 * Represents a Cassandra node.
 * @extends EventEmitter
 */
class Host extends events.EventEmitter {
    /**
     * Gets the ip address and port number of the node.
     *
     * Use {@link Host#addressToString} to get the conventional `ip:port` string form.
     */
    address: net.SocketAddress;

    /**
     * Gets string containing the Cassandra version.
     */
    cassandraVersion: string | null;

    /**
     * Gets data center name of the node.
     */
    datacenter: string | null;

    /**
     * Gets rack name of the node.
     */
    rack: string | null;

    /**
     * Gets the id of the host.
     *
     * This identifier is used by the server for internal communication / gossip.
     */
    hostId: Uuid;

    /**
     * Live handle to this node in the Rust driver's cluster state.
     */
    #node: rust.NodeHandle;

    /**
     * Creates a new Host instance.
     *
     * Instances of this class are constructed directly from the native code when reading cluster metadata.
     * @internal
     * @ignore
     */
    constructor(
        address: net.SocketAddress,
        datacenter: string | null,
        rack: string | null,
        hostId: Buffer,
        node: rust.NodeHandle,
    ) {
        super();
        this.#node = node;
        this.address = address;
        this.cassandraVersion = null;
        this.datacenter = datacenter;
        this.rack = rack;
        this.hostId = Uuid.fromRust(hostId);
    }
    /**
     * Determines if the node is UP now and the driver has working connections to it.
     *
     * In particular, if there's a network partition and the node is seen as UP by other nodes
     * but driver has no connections to it, then this will return `false`.
     */
    isUp(): boolean {
        return this.#node.isConnected();
    }

    /**
     * This endpoint is not yet implemented, and its usage will throw an error
     *
     * Returns an array containing the Cassandra Version as an Array of Numbers having the major version in the first
     * position.
     */
    getCassandraVersion(): number[] {
        // We never set the version when creating object from Rust,
        // so we will explicitly throw an error, when someone attempts to get the version
        // to avoid any confusion
        throw new Error(`TODO: Not implemented`);
        // if (!this.cassandraVersion) {
        //     return utils.emptyArray;
        // }
        // return this.cassandraVersion
        //     .split("-")[0]
        //     .split(".")
        //     .map((x) => parseInt(x, 10));
    }

    /**
     * Returns the string representation of the host's address.
     * @internal
     * @ignore
     */
    addressToString(): string {
        return socketAddressToString(this.address);
    }
}

/**
 * Represents an associative-array of {@link Host hosts} that can be iterated.
 * It creates an internal copy when adding or removing, making it safe to iterate using the values()
 * method within async operations.
 * @extends events.EventEmitter
 */
class HostMap extends events.EventEmitter {
    #hostsById: Record<string, Host>;
    #idByIp: Map<string, string>;
    #values: readonly Host[] | null;

    /** Number of hosts in the map. */
    length!: number;

    /**
     * Creates a new HostMap instance.
     *
     * Instances of this class are constructed directly from the native code when reading cluster
     * metadata, which passes an already-built `Record` of {@link Host} instances keyed by the
     * hex-encoded bytes of their host id, built directly on the Rust side - so this constructor
     * doesn't need to convert an intermediate array into a lookup structure itself.
     * @internal
     * @ignore
     */
    constructor(items: Record<string, Host>) {
        super();

        // Host instances keyed by the hex-encoded bytes of their host id, handed over
        // already-built from Rust.
        this.#hostsById = items;
        // Host id keys, keyed by the host's stringified address.
        this.#idByIp = new Map();
        this.#values = null;

        for (const [key, host] of Object.entries(items)) {
            this.#idByIp.set(socketAddressToString(host.address), key);
        }

        Object.defineProperty(this, "length", {
            get: () => this.values().length,
            enumerable: true,
        });

        /**
         * Emitted when a host is added to the map
         * @event HostMap#add
         */
        /**
         * Emitted when a host is removed from the map
         * @event HostMap#remove
         */
    }

    /**
     * Executes a provided function once per map element.
     */
    forEach(callback: (value: Host, key: Uuid) => void): void {
        for (const host of Object.values(this.#hostsById)) {
            callback(host, host.hostId);
        }
    }

    /**
     * Gets a {@link Host host} by key or undefined if not found.
     */
    get(key: Uuid | Buffer | net.SocketAddress | string): Host | undefined {
        let itemKey: string | undefined;
        if (key instanceof Uuid) {
            itemKey = hostIdToString(key.buffer);
        } else if (key instanceof Buffer) {
            itemKey = hostIdToString(key);
        } else {
            // Not a host id - try resolving it as an address instead.
            const addressKey = key as net.SocketAddress | string;
            const ipKey =
                addressKey instanceof net.SocketAddress
                    ? socketAddressToString(addressKey)
                    : addressKey;
            itemKey = this.#idByIp.get(ipKey);
        }
        return itemKey === undefined ? undefined : this.#hostsById[itemKey];
    }

    /**
     * Returns an array of host ids.
     */
    keys(): Uuid[] {
        return Object.values(this.#hostsById).map((host) => host.hostId);
    }

    /**
     * Returns a shallow copy of the values of the map.
     */
    values(): readonly Host[] {
        if (!this.#values) {
            // Cache the values
            this.#values = Object.freeze(Object.values(this.#hostsById));
        }

        return this.#values;
    }

    /**
     * @internal
     * @ignore
     */
    inspect(): Readonly<Record<string, Host>> {
        return this.#hostsById;
    }

    /**
     * @internal
     * @ignore
     */
    toJSON(): Record<string, Host> {
        return Object.fromEntries(
            Object.values(this.#hostsById).map((host) => [
                host.hostId.toString(),
                host,
            ]),
        );
    }
}

export { Host, HostMap };

// Registers the Host and HostMap constructors, so that Rust can construct fully-formed
// instances directly when reading cluster metadata.
// `net.SocketAddress` is registered too, since Rust builds each host's address with it.
rust.registerSocketAddressCtor(net.SocketAddress);
rust.registerHostCtor(Host);
rust.registerHostMapCtor(HostMap);
