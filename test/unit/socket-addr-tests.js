"use strict";
const { assert } = require("chai");
const net = require("node:net");
const rust = require("../../index");

describe("SocketAddrWrapper", function () {
    // For this category, asserts are on the Rust side
    describe("Valid socket addresses", function () {
        it("should correctly parse IPv4 address with port 8080", function () {
            const socketAddr = {
                address: "127.0.0.1",
                port: 8080,
            };
            rust.testsSocketAddrWrapper(socketAddr, 1);
        });

        it("should correctly parse IPv4 address with port 8080 using net.SocketAddress", function () {
            rust.testsSocketAddrWrapper(
                new net.SocketAddress({ address: "127.0.0.1", port: 8080 }),
                1,
            );
        });

        it("should correctly parse IPv4 address with port 9042", function () {
            const socketAddr = {
                address: "192.168.1.1",
                port: 9042,
            };
            rust.testsSocketAddrWrapper(socketAddr, 2);
        });

        it("should correctly parse IPv4 address with port 9042 using net.SocketAddress", function () {
            rust.testsSocketAddrWrapper(
                new net.SocketAddress({ address: "192.168.1.1", port: 9042 }),
                2,
            );
        });

        it("should correctly parse IPv6 loopback address with port 7000", function () {
            const socketAddr = {
                address: "::1",
                port: 7000,
            };
            rust.testsSocketAddrWrapper(socketAddr, 3);
        });

        it("should correctly parse IPv6 loopback address with port 7000 using net.SocketAddress", function () {
            rust.testsSocketAddrWrapper(
                new net.SocketAddress({
                    address: "::1",
                    port: 7000,
                    family: "ipv6",
                }),
                3,
            );
        });

        it("should correctly parse IPv6 address with port 3000", function () {
            const socketAddr = {
                address: "2001:db8:3333:4444:CCCC:DDDD:EEEE:FFFF",
                port: 3000,
            };
            rust.testsSocketAddrWrapper(socketAddr, 4);
        });

        it("should correctly parse IPv6 address with port 3000 using net.SocketAddress", function () {
            rust.testsSocketAddrWrapper(
                new net.SocketAddress({
                    address: "2001:db8:3333:4444:CCCC:DDDD:EEEE:FFFF",
                    port: 3000,
                    family: "ipv6",
                }),
                4,
            );
        });

        it("should correctly parse IPv4 0.0.0.0 with port 0", function () {
            const socketAddr = {
                address: "0.0.0.0",
                port: 0,
            };
            rust.testsSocketAddrWrapper(socketAddr, 5);
        });

        it("should correctly parse IPv4 0.0.0.0 with port 0 using net.SocketAddress", function () {
            rust.testsSocketAddrWrapper(
                new net.SocketAddress({ address: "0.0.0.0", port: 0 }),
                5,
            );
        });

        it("should correctly parse IPv6 :: with max port 65535", function () {
            const socketAddr = {
                address: "::",
                port: 65535,
            };
            rust.testsSocketAddrWrapper(socketAddr, 6);
        });

        it("should correctly parse IPv6 :: with max port 65535 using net.SocketAddress", function () {
            rust.testsSocketAddrWrapper(
                new net.SocketAddress({
                    address: "::",
                    port: 65535,
                    family: "ipv6",
                }),
                6,
            );
        });
    });

    describe("Error cases", function () {
        it("should throw error when address field is missing", function () {
            const socketAddr = {
                port: 8080,
            };
            assert.throws(
                () => rust.testsSocketAddrWrapper(socketAddr, 1),
                "Cannot retrieve socket address. Missing address field",
            );
        });

        it("should throw error when port field is missing", function () {
            const socketAddr = {
                address: "127.0.0.1",
            };
            assert.throws(
                () => rust.testsSocketAddrWrapper(socketAddr, 1),
                "Cannot retrieve socket address. Missing port field",
            );
        });

        it("should throw error when address is invalid", function () {
            const socketAddr = {
                address: "invalid-ip",
                port: 8080,
            };
            assert.throws(
                () => rust.testsSocketAddrWrapper(socketAddr, 1),
                /Could not parse IP address/,
            );
        });

        it("should throw error when address is empty", function () {
            const socketAddr = {
                address: "",
                port: 8080,
            };
            assert.throws(
                () => rust.testsSocketAddrWrapper(socketAddr, 1),
                /Could not parse IP address/,
            );
        });

        it("should throw error when port is out of range", function () {
            const socketAddr = {
                address: "127.0.0.1",
                port: 70000, // > 65535
            };
            // Port will be handled by napi type conversion
            assert.throws(() => rust.testsSocketAddrWrapper(socketAddr, 1));
        });
    });
});
