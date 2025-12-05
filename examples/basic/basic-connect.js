"use strict";
const cassandra = require("scylladb-nodejs-rs-driver");
const { getClientArgs } = require("../util");

const client = new cassandra.Client(getClientArgs());
client
    .connect()
    .then(function () {
        console.log(
            "Connected to cluster with %d host(s): %j",
            client.hosts.length,
            client.hosts.keys(),
        );
        // Currently the driver does not support that metadata field.
        // console.log("Keyspaces: %j", Object.keys(client.metadata.keyspaces));
        console.log("Connected to cluster.");
        return;
    })
    .catch(function (err) {
        console.error("There was an error when connecting", err);
    });
