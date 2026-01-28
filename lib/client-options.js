"use strict";

const util = require("util");
const policies = require("./policies");
const types = require("./types");
const utils = require("./utils");
const tracker = require("./tracker");
const metrics = require("./metrics");
const auth = require("./auth");
const { throwNotSupported } = require("./new-utils");
const errors = require("./errors.js");
const rust = require("../index");

/**
 * Client options.
 *
 * While the driver provides lots of extensibility points and configurability, few client options are required.
 *
 * Default values for all settings are designed to be suitable for the majority of use cases, you should avoid
 * fine tuning it when not needed.
 *
 * See [Client constructor]{@link Client} documentation for recommended options.
 *
 * @typedef {Object} ClientOptions
 * @property {Array.<string>} contactPoints
 * Array of addresses or host names of the nodes to add as contact points.
 *
 * Contact points are addresses of Cassandra nodes that the driver uses to discover the cluster topology.
 *
 * Only one contact point is required (the driver will retrieve the address of the other nodes automatically),
 * but it is usually a good idea to provide more than one contact point, because if that single contact point is
 * unavailable, the driver will not be able to initialize correctly.
 *
 * @property {String} [localDataCenter] The local data center to use.
 *
 * If using DCAwareRoundRobinPolicy (default), this option is required and only hosts from this data center are
 * connected to and used in query plans.
 *
 * [TODO: Add support for this field]
 * @property {String} [keyspace] The logged keyspace for all the connections created within the {@link Client} instance.
 * @property {Object} [credentials] An object containing the username and password for plain-text authentication.
 * It configures the authentication provider to be used against Apache Cassandra's PasswordAuthenticator or DSE's
 * DseAuthenticator, when default auth scheme is plain-text.
 *
 * Note that you should configure either `credentials` or `authProvider` to connect to an
 * auth-enabled cluster, but not both.
 *
 * @property {String} [credentials.username] The username to use for plain-text authentication.
 * @property {String} [credentials.password] The password to use for plain-text authentication.
 * @property {Uuid | string} [id] A unique identifier assigned to a {@link Client} object, that will be communicated to the
 * server to identify the client instance created with this options. When not defined, the driver will
 * generate a random identifier.
 * @property {String} [applicationName] An optional setting identifying the name of the application using
 * the {@link Client} instance.
 *
 * This value is passed to database and is useful as metadata for describing a client connection on the server side.
 * @property {String} [applicationVersion] An optional setting identifying the version of the application using
 * the {@link Client} instance.
 *
 * This value is passed to database and is useful as metadata for describing a client connection on the server side.
 * @property {Object} [monitorReporting] Options for reporting mechanism from the client to the DSE server, for
 * versions that support it.
 * [TODO: Add support for this field]
 * @property {Boolean} [monitorReporting.enabled=true] Determines whether the reporting mechanism is enabled.
 * Defaults to `true`.
 * [TODO: Add support for this field]
 * @property {Object} [cloud] The options to connect to a cloud instance.
 * [TODO: Add support for this field Remove?]
 * @property {String|URL} cloud.secureConnectBundle Determines the file path for the credentials file bundle.
 * [TODO: Add support for this field Remove?]
 * @property {Number} [refreshSchemaDelay] The default window size in milliseconds used to debounce node list and schema
 * refresh metadata requests. Default: 1000.
 * [TODO: Add support for this field]
 * @property {Boolean} [isMetadataSyncEnabled] Determines whether client-side schema metadata retrieval and update is
 * enabled.
 *
 * Setting this value to `false` will cause keyspace information not to be automatically loaded, affecting
 * replica calculation per token in the different keyspaces. When disabling metadata synchronization, use
 * [Metadata.refreshKeyspaces()]{@link module:metadata~Metadata#refreshKeyspaces} to keep keyspace information up to
 * date or token-awareness will not work correctly.
 *
 * Default: `true`.
 * [TODO: Add support for this field]
 * @property {Boolean} [prepareOnAllHosts] Determines if the driver should prepare queries on all hosts in the cluster.
 * Default: `true`.
 * [TODO: Add support for this field]
 * @property {Boolean} [rePrepareOnUp] Determines if the driver should re-prepare all cached prepared queries on a
 * host when it marks it back up.
 * Default: `true`.
 * [TODO: Add support for this field]
 * @property {Number} [maxPrepared] Determines the maximum amount of different prepared queries before evicting items
 * from the internal cache. Reaching a high threshold hints that the queries are not being reused, like when
 * hard-coding parameter values inside the queries.
 * Default: `512`.
 * @property {Object} [policies]
 * [TODO: Add support for this field]
 * @property {LoadBalancingPolicy} [policies.loadBalancing] The load balancing policy instance to be used to determine
 * the coordinator per query.
 * [TODO: Add support for this field]
 * @property {RetryPolicy} [policies.retry] The retry policy.
 * [TODO: Add support for this field]
 * @property {ReconnectionPolicy} [policies.reconnection] The reconnection policy to be used.
 * [TODO: Add support for this field]
 * @property {AddressTranslator} [policies.addressResolution] The address resolution policy.
 * [TODO: Add support for this field]
 * @property {SpeculativeExecutionPolicy} [policies.speculativeExecution] The `SpeculativeExecutionPolicy`
 * instance to be used to determine if the client should send speculative queries when the selected host takes more
 * time than expected.
 *
 * Default: `[NoSpeculativeExecutionPolicy]{@link
 * module:policies/speculativeExecution~NoSpeculativeExecutionPolicy}`
 *
 * [TODO: Add support for this field]
 * @property {TimestampGenerator} [policies.timestampGeneration] The client-side
 * [query timestamp generator]{@link module:policies/timestampGeneration~TimestampGenerator}.
 *
 * Default: `[MonotonicTimestampGenerator]{@link module:policies/timestampGeneration~MonotonicTimestampGenerator}`
 *
 * Use `null` to disable client-side timestamp generation.
 *
 * [TODO: Add support for this field]
 * @property {QueryOptions} [queryOptions] Default options for all queries.
 * [TODO: Add support for this field]
 * @property {Object} [pooling] Pooling options.
 * [TODO: Add support for this field]
 * @property {Number} [pooling.heartBeatInterval] The amount of idle time in milliseconds that has to pass before the
 * driver issues a request on an active connection to avoid idle time disconnections. Default: 30000.
 * [TODO: Add support for this field]
 * @property {Object} [pooling.coreConnectionsPerHost] Associative array containing amount of connections per host
 * distance.
 * [TODO: Add support for this field]
 * @property {Number} [pooling.maxRequestsPerConnection] The maximum number of requests per connection. The default
 * value is:
 * - For modern protocol versions (v3 and above): 2048
 * - For older protocol versions (v1 and v2): 128
 *
 * [TODO: Add support for this field]
 * @property {Boolean} [pooling.warmup] Determines if all connections to hosts in the local datacenter must be opened on
 * connect. Default: true.
 * [TODO: Add support for this field]
 * @property {Object} [protocolOptions]
 * [TODO: Add support for this field]
 * @property {Number} [protocolOptions.port] The port to use to connect to the Cassandra host. If not set through this
 * method, the default port (9042) will be used instead.
 * [TODO: Add support for this field]
 * @property {Number} [protocolOptions.maxSchemaAgreementWaitSeconds] The maximum time in seconds to wait for schema
 * agreement between nodes before returning from a DDL query. Default: 10.
 * [TODO: Add support for this field]
 * @property {Number} [protocolOptions.maxVersion] When set, it limits the maximum protocol version used to connect to
 * the nodes.
 * Useful for using the driver against a cluster that contains nodes with different major/minor versions of Cassandra.
 * [TODO: Add support for this field]
 * @property {Boolean} [protocolOptions.noCompact] When set to true, enables the NO_COMPACT startup option.
 *
 * When this option is supplied `SELECT`, `UPDATE`, `DELETE`, and `BATCH`
 * statements on `COMPACT STORAGE` tables function in "compatibility" mode which allows seeing these tables
 * as if they were "regular" CQL tables.
 *
 * This option only effects interactions with interactions with tables using `COMPACT STORAGE` and is only
 * supported by C* 3.0.16+, 3.11.2+, 4.0+ and DSE 6.0+.
 *
 * [TODO: Add support for this field]
 * @property {Object} [socketOptions]
 * [TODO: Add support for this field]
 * @property {Number} [socketOptions.connectTimeout] Connection timeout in milliseconds. Default: 5000.
 * [TODO: Add support for this field]
 * @property {Number} [socketOptions.defunctReadTimeoutThreshold] Determines the amount of requests that simultaneously
 * have to timeout before closing the connection. Default: 64.
 * [TODO: Add support for this field]
 * @property {Boolean} [socketOptions.keepAlive] Whether to enable TCP keep-alive on the socket. Default: true.
 * [TODO: Add support for this field]
 * @property {Number} [socketOptions.keepAliveDelay] TCP keep-alive delay in milliseconds. Default: 0.
 * [TODO: Add support for this field]
 * @property {Number} [socketOptions.readTimeout] Per-host read timeout in milliseconds.
 *
 * Please note that this is not the maximum time a call to {@link Client#execute} may have to wait;
 * this is the maximum time that call will wait for one particular Cassandra host, but other hosts will be tried if
 * one of them timeout. In other words, a {@link Client#execute} call may theoretically wait up to
 * `readTimeout * number_of_cassandra_hosts` (though the total number of hosts tried for a given query also
 * depends on the LoadBalancingPolicy in use).
 *
 * When setting this value, keep in mind the following:
 * - the timeout settings used on the Cassandra side (*_request_timeout_in_ms in cassandra.yaml) should be taken
 * into account when picking a value for this read timeout. You should pick a value a couple of seconds greater than
 * the Cassandra timeout settings.
 * - the read timeout is only approximate and only control the timeout to one Cassandra host, not the full query.
 *
 * Setting a value of 0 disables read timeouts. Default: `12000`.
 * [TODO: Add support for this field]
 * @property {Boolean} [socketOptions.tcpNoDelay] When set to true, it disables the Nagle algorithm. Default: true.
 * [TODO: Add support for this field]
 * @property {Number} [socketOptions.coalescingThreshold] Buffer length in bytes use by the write queue before flushing
 * the frames. Default: 8000.
 * [TODO: Add support for this field]
 * @property {AuthProvider} [authProvider] Provider to be used to authenticate to an auth-enabled cluster.
 * [TODO: Add support for this field]
 * @property {RequestTracker} [requestTracker] The instance of RequestTracker used to monitor or log requests executed
 * with this instance.
 * [TODO: Add support for this field]
 * @property {SslOptions} [sslOptions] Client-to-node ssl options. When set the driver will use the secure layer.
 * You can specify cert, ca, ... options named after the Node.js `tls.connect()` options.
 *
 * It uses the same default values as Node.js `tls.connect()`
 * [TODO: For now, only limited subset of ssl options is supported]
 * @property {Object} [encoding] Encoding options.
 * [TODO: Add support for this field]
 * @property {Function} [encoding.map] Map constructor to use for Cassandra map<k,v> type encoding and decoding.
 * If not set, it will default to Javascript Object with map keys as property names.
 * [TODO: Add support for this field]
 * @property {Function} [encoding.set] Set constructor to use for Cassandra set<k> type encoding and decoding.
 * If not set, it will default to Javascript Array.
 * [TODO: Add support for this field]
 * @property {Boolean} [encoding.copyBuffer] Determines if the network buffer should be copied for buffer based data
 * types (blob, uuid, timeuuid and inet).
 *
 * Setting it to true will cause that the network buffer is copied for each row value of those types,
 * causing additional allocations but freeing the network buffer to be reused.
 * Setting it to true is a good choice for cases where the Row and ResultSet returned by the queries are long-lived
 * objects.
 *
 * Setting it to false will cause less overhead and the reference of the network buffer to be maintained until the row
 * / result set are de-referenced.
 * Default: true.
 *
 * [TODO: Add support for this field]
 * @property {Boolean} [encoding.useUndefinedAsUnset] Valid for Cassandra 2.2 and above. Determines that, if a parameter
 * is set to `undefined` it should be encoded as `unset`.
 *
 * By default, ECMAScript `undefined` is encoded as `null` in the driver. Cassandra 2.2
 * introduced the concept of unset.
 * At driver level, you can set a parameter to unset using the field `types.unset`. Setting this flag to
 * true allows you to use ECMAScript undefined as Cassandra `unset`.
 *
 * Default: true.
 * @property {Boolean} [encoding.useBigIntAsLong] Use [BigInt type](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)
 * to represent CQL bigint and counter data types. Defaults to true.
 * @property {Boolean} [encoding.useBigIntAsVarint] Use [BigInt type](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt)
 * to represent CQL varint data type. Defaults to true.
 *
 * Note, that using Integer as Varint (`useBigIntAsVarint == false`) is deprecated.
 * @property {Array.<ExecutionProfile>} [profiles] The array of [execution profiles]{@link ExecutionProfile}.
 * [TODO: Add support for this field]
 * @property {Function} [promiseFactory] Function to be used to create a `Promise` from a
 * callback-style function.
 *
 * Promise libraries often provide different methods to create a promise. For example, you can use Bluebird's
 * `Promise.fromCallback()` method.
 *
 * By default, the driver will use the
 * [Promise constructor]{@link https://developer.mozilla.org/en/docs/Web/JavaScript/Reference/Global_Objects/Promise}.
 *
 * [TODO: Add support for this field]
 */

/**
 * SSL/TLS options for secure connections.
 * Based on Node.js tls.ConnectionOptions which extends SecureContextOptions and CommonConnectionOptions.
 */
class SslOptions {
    // All of the comments are copied from Node.js docs for tls version of this class
    // See: https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/tls.d.ts
    /**
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     * @type {(string | Buffer | Array<string | Buffer>)?}
     */
    ca;

    /**
     * Cert chains in PEM format. One cert chain should be provided per private key.
     * Each cert chain should consist of the PEM formatted certificate for a provided
     * private key, followed by the PEM formatted intermediate certificates (if any),
     * in order, and not including the root CA.
     *
     * Only a single cert chain is currently supported by the driver.
     * @type {(string | Buffer)?}
     */
    cert;

    /**
     * Colon-separated list of supported signature algorithms.
     * The list can contain digest algorithms (SHA256, MD5 etc.), public key algorithms
     * (RSA-PSS, ECDSA etc.), combination of both (e.g 'RSA+SHA384') or TLS v1.3 scheme names.
     * @type {string?}
     */
    sigalgs;

    /**
     * Cipher suite specification, replacing the default.
     * Permitted ciphers can be obtained via tls.getCiphers().
     * Cipher names must be uppercased in order for OpenSSL to accept them.
     * @type {string?}
     */
    ciphers;

    /**
     * A string describing a named curve or a colon separated list of curve NIDs or names,
     * for example P-521:P-384:P-256, to use for ECDH key agreement.
     * Set to auto to select the curve automatically.
     * @type {string?}
     */
    ecdhCurve;

    /**
     * Attempt to use the server's cipher suite preferences instead of the client's.
     * When true, causes SSL_OP_CIPHER_SERVER_PREFERENCE to be set in secureOptions.
     * @type {boolean?}
     */
    honorCipherOrder;

    /**
     * Private keys in PEM format. PEM allows the option of private keys being encrypted.
     * Encrypted keys will be decrypted with options.passphrase.
     * Multiple keys using different algorithms can be provided either as an array of
     * unencrypted key strings or buffers, or an array of objects in the form
     * {pem: <string|buffer>[, passphrase: <string>]}.
     *
     * Only a single cert chain, and as a result a single private key
     * is currently supported by the driver.
     * @type {(string | Buffer)?}
     */
    key;

    /**
     * Optionally set the maximum TLS version to allow.
     * One of 'TLSv1.3', 'TLSv1.2', 'TLSv1.1', or 'TLSv1'.
     * Cannot be specified along with the secureProtocol option.
     * @type {('TLSv1.3' | 'TLSv1.2' | 'TLSv1.1' | 'TLSv1')?}
     */
    maxVersion;

    /**
     * Optionally set the minimum TLS version to allow.
     * One of 'TLSv1.3', 'TLSv1.2', 'TLSv1.1', or 'TLSv1'.
     * Cannot be specified along with the secureProtocol option.
     * It is not recommended to use less than TLSv1.2.
     * @type {('TLSv1.3' | 'TLSv1.2' | 'TLSv1.1' | 'TLSv1')?}
     */
    minVersion;

    /**
     * Shared passphrase used for a single private key and/or a PFX.
     * @type {string?}
     */
    passphrase;

    /**
     * PFX or PKCS12 encoded private key and certificate chain.
     * pfx is an alternative to providing key and cert individually.
     * PFX is usually encrypted, if it is, passphrase will be used to decrypt it.
     *
     * Only a single cert chain is currently supported by the driver.
     * @type {(string | Buffer)?}
     */
    pfx;

    /**
     * Optionally affect the OpenSSL protocol behavior, which is not usually necessary.
     * Value is a numeric bitmask of the SSL_OP_* options from OpenSSL Options.
     * @type {number?}
     */
    secureOptions;

    /**
     * Opaque identifier used by servers to ensure session state is not shared between applications.
     * Unused by clients.
     * @type {string?}
     */
    sessionIdContext;

    /**
     * If true the server will reject any connection which is not authorized
     * with the list of supplied CAs. This option only has an effect if requestCert is true.
     * @type {boolean?}
     * @default true
     */
    rejectUnauthorized;
}

/** Core connections per host for protocol versions 1 and 2 */
const coreConnectionsPerHostV2 = {
    [types.distance.local]: 2,
    [types.distance.remote]: 1,
    [types.distance.ignored]: 0,
};

/** Core connections per host for protocol version 3 and above */
const coreConnectionsPerHostV3 = {
    [types.distance.local]: 1,
    [types.distance.remote]: 1,
    [types.distance.ignored]: 0,
};

/** Default maxRequestsPerConnection value for protocol v1 and v2 */
const maxRequestsPerConnectionV2 = 128;

/** Default maxRequestsPerConnection value for protocol v3+ */
const maxRequestsPerConnectionV3 = 2048;

const continuousPageUnitBytes = "bytes";
const continuousPageDefaultSize = 5000;
const continuousPageDefaultHighWaterMark = 10000;

/**
 * @returns {ClientOptions}
 */
function defaultOptions() {
    return {
        policies: {
            addressResolution: policies.defaultAddressTranslator(),
            loadBalancing: policies.defaultLoadBalancingPolicy(),
            reconnection: policies.defaultReconnectionPolicy(),
            retry: policies.defaultRetryPolicy(),
            speculativeExecution: policies.defaultSpeculativeExecutionPolicy(),
            timestampGeneration: policies.defaultTimestampGenerator(),
        },
        queryOptions: {
            fetchSize: 5000,
            prepare: false,
            captureStackTrace: false,
            paged: true,
        },
        protocolOptions: {
            port: 9042,
            maxSchemaAgreementWaitSeconds: 10,
            maxVersion: 0,
            noCompact: false,
        },
        pooling: {
            heartBeatInterval: 30000,
            warmup: true,
        },
        socketOptions: {
            connectTimeout: 5000,
            defunctReadTimeoutThreshold: 64,
            keepAlive: true,
            keepAliveDelay: 0,
            readTimeout: 12000,
            tcpNoDelay: true,
            coalescingThreshold: 65536,
        },
        authProvider: null,
        requestTracker: null,
        metrics: new metrics.DefaultMetrics(),
        maxPrepared: null, // Default is 512, defined on the Rust side
        refreshSchemaDelay: 1000,
        isMetadataSyncEnabled: true,
        prepareOnAllHosts: true,
        rePrepareOnUp: true,
        encoding: {
            copyBuffer: true,
            useUndefinedAsUnset: true,
            useBigIntAsLong: true,
            useBigIntAsVarint: true,
        },
        monitorReporting: {
            enabled: true,
        },
    };
}

/**
 * Extends and validates the user options
 * @param {Object} [baseOptions] The source object instance that will be overridden
 * @param {Object} userOptions
 * @returns {Object}
 */
function extend(baseOptions, userOptions) {
    if (arguments.length === 1) {
        userOptions = arguments[0];
        baseOptions = {};
    }
    const options = utils.deepExtend(
        baseOptions,
        defaultOptions(),
        userOptions,
    );

    if (options.cloud) {
        throwNotSupported("Cloud options");
    }

    if (
        !Array.isArray(options.contactPoints) ||
        options.contactPoints.length === 0
    ) {
        throw new TypeError("Contacts points are not defined.");
    }

    for (let i = 0; i < options.contactPoints.length; i++) {
        const hostName = options.contactPoints[i];
        if (!hostName) {
            throw new TypeError(
                util.format(
                    "Contact point %s (%s) is not a valid host name, " +
                        "the following values are valid contact points: ipAddress, hostName or ipAddress:port",
                    i,
                    hostName,
                ),
            );
        }
    }

    options.sni = undefined;

    if (!options.logEmitter) {
        options.logEmitter = function () {};
    }
    if (!options.queryOptions) {
        throw new TypeError("queryOptions not defined in options");
    }

    if (
        options.requestTracker !== null &&
        !(options.requestTracker instanceof tracker.RequestTracker)
    ) {
        throw new TypeError(
            "requestTracker must be an instance of RequestTracker",
        );
    }

    if (!(options.metrics instanceof metrics.ClientMetrics)) {
        throw new TypeError("metrics must be an instance of ClientMetrics");
    }

    validatePoliciesOptions(options.policies);

    validateProtocolOptions(options.protocolOptions);

    validateSocketOptions(options.socketOptions);

    validateAuthenticationOptions(options);

    options.encoding = options.encoding || {};

    validateEncodingOptions(options.encoding);

    if (options.profiles && !Array.isArray(options.profiles)) {
        throw new TypeError(
            "profiles must be an Array of ExecutionProfile instances",
        );
    }

    validateApplicationInfo(options);

    validateMonitorReporting(options);

    return options;
}

/**
 * Validates the policies from the client options.
 * @param {ClientOptions.policies} policiesOptions
 * @private
 */
function validatePoliciesOptions(policiesOptions) {
    if (!policiesOptions) {
        throw new TypeError("policies not defined in options");
    }
    if (
        !(
            policiesOptions.loadBalancing instanceof
            policies.loadBalancing.LoadBalancingPolicy
        )
    ) {
        throw new TypeError(
            "Load balancing policy must be an instance of LoadBalancingPolicy",
        );
    }
    if (
        !(
            policiesOptions.reconnection instanceof
            policies.reconnection.ReconnectionPolicy
        )
    ) {
        throw new TypeError(
            "Reconnection policy must be an instance of ReconnectionPolicy",
        );
    }
    if (!(policiesOptions.retry instanceof policies.retry.RetryPolicy)) {
        throw new TypeError("Retry policy must be an instance of RetryPolicy");
    }
    if (
        !(
            policiesOptions.addressResolution instanceof
            policies.addressResolution.AddressTranslator
        )
    ) {
        throw new TypeError(
            "Address resolution policy must be an instance of AddressTranslator",
        );
    }
    if (
        policiesOptions.timestampGeneration !== null &&
        !(
            policiesOptions.timestampGeneration instanceof
            policies.timestampGeneration.TimestampGenerator
        )
    ) {
        throw new TypeError(
            "Timestamp generation policy must be an instance of TimestampGenerator",
        );
    }
}

/**
 * Validates the protocol options.
 * @param {ClientOptions.protocolOptions} protocolOptions
 * @private
 */
function validateProtocolOptions(protocolOptions) {
    if (!protocolOptions) {
        throw new TypeError("protocolOptions not defined in options");
    }
    const version = protocolOptions.maxVersion;
    if (
        version &&
        (typeof version !== "number" ||
            !types.protocolVersion.isSupported(version))
    ) {
        throw new TypeError(
            util.format(
                "protocolOptions.maxVersion provided (%s) is invalid",
                version,
            ),
        );
    }
}

/**
 * Validates the socket options.
 * @param {ClientOptions.socketOptions} socketOptions
 * @private
 */
function validateSocketOptions(socketOptions) {
    if (!socketOptions) {
        throw new TypeError("socketOptions not defined in options");
    }
    if (typeof socketOptions.readTimeout !== "number") {
        throw new TypeError("socketOptions.readTimeout must be a Number");
    }
    if (
        typeof socketOptions.coalescingThreshold !== "number" ||
        socketOptions.coalescingThreshold <= 0
    ) {
        throw new TypeError(
            "socketOptions.coalescingThreshold must be a positive Number",
        );
    }
}

/**
 * Validates authentication provider and credentials.
 * @param {ClientOptions} options
 * @private
 */
function validateAuthenticationOptions(options) {
    if (!options.authProvider) {
        const credentials = options.credentials;
        if (credentials) {
            if (
                typeof credentials.username !== "string" ||
                typeof credentials.password !== "string"
            ) {
                throw new TypeError(
                    "credentials username and password must be a string",
                );
            }
        } else {
            options.authProvider = new auth.NoAuthProvider();
        }
    } else if (!(options.authProvider instanceof auth.AuthProvider)) {
        throw new TypeError(
            "options.authProvider must be an instance of AuthProvider",
        );
    }
}

/**
 * Validates the encoding options.
 * @param {ClientOptions.encoding} encodingOptions
 * @private
 */
function validateEncodingOptions(encodingOptions) {
    if (encodingOptions.map) {
        const mapConstructor = encodingOptions.map;
        if (
            typeof mapConstructor !== "function" ||
            typeof mapConstructor.prototype.forEach !== "function" ||
            typeof mapConstructor.prototype.set !== "function"
        ) {
            throw new TypeError("Map constructor not valid");
        }
    }

    if (encodingOptions.set) {
        const setConstructor = encodingOptions.set;
        if (
            typeof setConstructor !== "function" ||
            typeof setConstructor.prototype.forEach !== "function" ||
            typeof setConstructor.prototype.add !== "function"
        ) {
            throw new TypeError("Set constructor not valid");
        }
    }
}

function validateApplicationInfo(options) {
    function validateString(key) {
        const str = options[key];

        if (str !== null && str !== undefined && typeof str !== "string") {
            throw new TypeError(`${key} should be a String`);
        }
    }

    validateString("applicationName");
    validateString("applicationVersion");

    if (
        options.id !== null &&
        options.id !== undefined &&
        !(options.id instanceof types.Uuid)
    ) {
        throw new TypeError("Client id must be a Uuid");
    }
}

function validateMonitorReporting(options) {
    const o = options.monitorReporting;
    if (o === null || typeof o !== "object") {
        throw new TypeError(
            `Monitor reporting must be an object, obtained: ${o}`,
        );
    }
}

/**
 * Normalizes a key that can be either a string or a buffer into a string.
 * @param {string | Buffer} value
 * @param {string} name Name of the option being normalized, used for error messages
 * @returns {string}
 */
function normalizeKey(value, name) {
    if (typeof value === "string") {
        return value;
    }
    if (Buffer.isBuffer(value)) {
        return value.toString("binary");
    }
    throw new TypeError(
        `Unexpected type for ${name}. Expected to be string or buffer, got ${typeof value}`,
    );
}

/**
 * According to the TS type definition, SecureVersion (the value we are handling here),
 * can be one of the following:
 * type SecureVersion = "TLSv1.3" | "TLSv1.2" | "TLSv1.1" | "TLSv1";
 * @param {'TLSv1.3' | 'TLSv1.2' | 'TLSv1.1' | 'TLSv1'} value
 * @returns {rust.TlsVersion}
 */
function normalizeTlsVersion(value) {
    if (typeof value !== "string") {
        throw new TypeError("TLS version must be a string");
    }
    switch (value.toUpperCase()) {
        case "TLSV1":
            return rust.TlsVersion.Tlsv1;
        case "TLSV1.1":
            return rust.TlsVersion.Tlsv1_1;
        case "TLSV1.2":
            return rust.TlsVersion.Tlsv1_2;
        case "TLSV1.3":
            return rust.TlsVersion.Tlsv1_3;
        default:
            throw new TypeError(
                `Invalid TLS version: ${value}. Expected one of: TLSv1, TLSv1.1, TLSv1.2, TLSv1.3.`,
            );
    }
}

/**
 * Normalizes SSL options to be passed to the Rust layer.
 * The SslOptions class can have values as multiple types,
 * while the Rust code expects a specific format.
 * We could do this at the napi layer by trying all accepted types
 * until we successfully convert it, but we can also convert it here.
 * @param {SslOptions} sslOptions
 */
function normalizeSslOptions(sslOptions) {
    if (!sslOptions) {
        return sslOptions;
    }

    const normalized = { ...sslOptions };

    if (normalized.ca) {
        const caList = Array.isArray(normalized.ca)
            ? normalized.ca
            : [normalized.ca];
        normalized.ca = caList.map((entry) => normalizeKey(entry, "ca"));
    }

    if (normalized.cert) {
        normalized.cert = normalizeKey(normalized.cert, "cert");
    }

    if (normalized.dhparam) {
        normalized.dhparam = normalizeKey(normalized.dhparam, "dhparam");
    }

    if (normalized.key) {
        normalized.key = normalizeKey(normalized.key, "key");
    }

    if (normalized.pfx) {
        normalized.pfx = normalizeKey(normalized.pfx, "pfx");
    }

    if (normalized.minVersion) {
        normalized.minVersion = normalizeTlsVersion(normalized.minVersion);
    }

    if (normalized.maxVersion) {
        normalized.maxVersion = normalizeTlsVersion(normalized.maxVersion);
    }

    if (normalized.secureOptions) {
        normalized.secureOptions = BigInt(normalized.secureOptions);
    }
    return normalized;
}

/**
 * Sets the default options that depend on the protocol version and other metadata.
 * @param {Client} client
 */
function setMetadataDependent(client) {
    const version = client.controlConnection.protocolVersion;
    let coreConnectionsPerHost = coreConnectionsPerHostV3;
    let maxRequestsPerConnection = maxRequestsPerConnectionV3;

    if (!types.protocolVersion.uses2BytesStreamIds(version)) {
        coreConnectionsPerHost = coreConnectionsPerHostV2;
        maxRequestsPerConnection = maxRequestsPerConnectionV2;
    }

    if (client.options.queryOptions.consistency === undefined) {
        client.options.queryOptions.consistency = client.metadata.isDbaas()
            ? types.consistencies.localQuorum
            : types.consistencies.localOne;
    }

    client.options.pooling = utils.deepExtend(
        {},
        { coreConnectionsPerHost, maxRequestsPerConnection },
        client.options.pooling,
    );
}

/**
 * Create rust options using js Client options
 * @param {ClientOptions} options
 * @returns {SessionOptions}
 * @private
 */
function setRustOptions(options) {
    let rustOptions = Object();
    rustOptions.connectPoints = options.contactPoints;
    rustOptions.applicationName = options.applicationName;
    rustOptions.applicationVersion = options.applicationVersion;
    if (options.id instanceof types.Uuid) {
        options.id = options.id.toString();
    }
    rustOptions.clientId = options.id;
    rustOptions.keyspace = options.keyspace;
    if (options.maxPrepared) {
        rustOptions.cacheSize = options.maxPrepared;
    }
    if (options.credentials) {
        rustOptions.credentialsUsername = options.credentials.username;
        rustOptions.credentialsPassword = options.credentials.password;
    } else if (options.authProvider) {
        if (options.authProvider instanceof auth.PlainTextAuthProvider) {
            rustOptions.credentialsUsername = options.authProvider.username;
            rustOptions.credentialsPassword = options.authProvider.password;
        } else if (!(options.authProvider instanceof auth.NoAuthProvider)) {
            throw new errors.ArgumentError(
                // TODO: Add support for other auth providers
                "Unsupported auth provider: " + options.authProvider,
            );
        }
    }

    if (options.policies) {
        if (options.policies.loadBalancing) {
            try {
                rustOptions.loadBalancingConfig =
                    options.policies.loadBalancing.getRustConfiguration();
            } catch (e) {
                // We will catch this error when:
                //  - The policy does not implement getRustConfiguration (someone provided policy that does not inherit from LoadBalancingPolicy)
                //  - The policy implements getRustConfiguration but throws "Currently this policy is not supported by the driver"
                //  - Some other obscure error, like node deciding it has a bad day and just wants to crash
                throw new Error(
                    `This load balancing policy (${options.policies.loadBalancing.constructor.name}) does not appear to be supported by the driver. Root cause: ${e.message}`,
                );
            }
        }
    }

    if (options.sslOptions) {
        rustOptions.sslOptions = normalizeSslOptions(options.sslOptions);
    }
    return rustOptions;
}

exports.extend = extend;
exports.setRustOptions = setRustOptions;
exports.defaultOptions = defaultOptions;
exports.coreConnectionsPerHostV2 = coreConnectionsPerHostV2;
exports.coreConnectionsPerHostV3 = coreConnectionsPerHostV3;
exports.maxRequestsPerConnectionV2 = maxRequestsPerConnectionV2;
exports.maxRequestsPerConnectionV3 = maxRequestsPerConnectionV3;
exports.setMetadataDependent = setMetadataDependent;
exports.continuousPageUnitBytes = continuousPageUnitBytes;
exports.continuousPageDefaultSize = continuousPageDefaultSize;
exports.continuousPageDefaultHighWaterMark = continuousPageDefaultHighWaterMark;
exports.SslOptions = SslOptions;
