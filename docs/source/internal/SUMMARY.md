# Summary

## Used shortcuts

Within this document (and internal code documentation) I may use informal names for different products.
Here you can find a list of those names in all their variants, with the versions we decided on in user-facing parts of the driver.

JS - JavaScript
TS - TypeScript

Node, NodeJs. Official: [Node.js](https://nodejs.org/)

Napi, NodeAPI, Napi-rs: see [napi.md](./napi.md#distinction). Official [Node-API](https://nodejs.org/api/n-api.html) and [NAPI-RS](https://napi.rs/).

DSx: Official: [DataStax](https://www.ibm.com/products/datastax)

DSx driver, old driver, DataStax driver, cassandra driver. Official:
[cassandra-driver/cassandra-nodejs-driver](https://github.com/apache/cassandra-nodejs-driver)
(The version depends on whether the language of the driver is obvious).
This driver was initially developed by DSx and was transferred to Apache during development of this driver.
For this reason some places may use the name referring to DSx. Any remaining public documentation should refer to this driver as
`cassandra-driver`, with possible annotation like: `formerly known as DataStax Node.js Driver` (see main [README.md](../../../README.md)).

this driver, new driver, scylladb-driver, scylladb-driver-alpha. Official: ScyllaDB Node.js-RS Driver / scylladb-driver-alpha / nodejs-rs-driver
(standalone name / package name / repository name). Confusing? No worries, this repo probably breaks this convention quite a lot.

## Sections

- [Errors](./error-throwing.md)
- [ParameterWrapper](./parameter-wrapper.md)
- [Query options overview](./query-options.md)
- [Napi](./napi.md)
- [Miscellaneous](./miscellaneous.md)
