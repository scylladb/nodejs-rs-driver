# Napi (and napi-rs)

## Distinction

Node-API and napi-rs are two different things. When encountering just "napi" in the documentation (or PRs/issues),
what is meant in most cases is Node-API (although there may be some exceptions, especially in old docs).
However, when you encounter napi in the code (mostly Rust code), this refers to napi-rs.

In napi-rs there are different kinds of interfaces. Some of the interfaces napi-rs exposes are just 1-to-1 mappings from Node-API (mostly `napi::sys`).
Then there are low-cost abstractions over Node-API, like `(To/From)NapiValue` traits and `napi::Env`.
Then there are high-cost interfaces. Some of those add overhead that we would need to handle on our own (like **sync** functions: functions with the `#[napi]` macro).
Others add high-cost overhead that we can avoid by using lower-abstraction-level approaches to achieve sometimes very significant performance improvements.
This often comes at the cost of some limitations, however those limitations rarely pose a problem for our use cases.

## Wrappers

There may be cases where you have some Rust value you want to work on, but the JS code does not need to have access to the members of such value,
only its methods (think: [client session](https://github.com/adespawn/nodejs/blob/452f2acd2d8794161a1866c4b336df75c038cd22/src/session.rs#L29-L32)).
In those cases you can create a wrapper that keeps the value private to Rust code and exposes methods through napi.

## Our interfaces

The main benefit of high-cost napi-rs interfaces is that they provide abstractions that very significantly reduce required verbosity.
This section briefly describes the available internal interfaces and their use cases:

The napi-rs offers [napi-rs classes](https://napi.rs/docs/concepts/class). They offer a quite easy to understand interface.
Using them is however [very](https://www.scylladb.com/wp-content/uploads/image10-5-768x768.png) [inefficient](https://www.scylladb.com/wp-content/uploads/image2-23-768x768.png),
as we [have](https://github.com/scylladb/nodejs-rs-driver/pull/182) [discovered](https://github.com/scylladb/nodejs-rs-driver/pull/181).

So why is it so slow?

Creating an [Object](https://nodejs.org/api/n-api.html#napi_create_object) through Node-API is quite slow, and possibly even slower than doing the same from JS code
(note: this is my recollection of things that happened over a year ago as of writing this documentation). Additionally, when [updating](https://github.com/scylladb/nodejs-rs-driver/pull/291)
to [napi-v3](https://napi.rs/docs/more/v2-v3-migration-guide), our existing use cases stopped working due to
[some problems](https://github.com/scylladb/nodejs-rs-driver/pull/291/commits/7c41208dc106f7ff20e1d0ffb9d33ecedd69e1ce) with BigInt.

To solve this problem, we have come up with a few workarounds, depending on the specific situation. For objects containing information, we design them
not to have any methods on them. This is necessary since our solutions introduce some limitations at the benefit of better usability / performance in our specific use cases.

### To Napi Value

This section describes solutions for converting values from Rust to JS code.

#### Solutions for performance

As mentioned above, creation of JS [Objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object) is quite expensive.
What we have come up with, when returning multiple values from performance-critical paths, is to return a tuple ([array](https://nodejs.org/api/n-api.html#napi_create_array))
of values we want to return.

You can find examples of such use cases in the [Rust part](https://github.com/scylladb/nodejs-rs-driver/blob/2e04a1701e4cfa039bac35c96d8b84b3a5f93867/src/paging.rs#L53-L73)
of the code, as well as the [js parsing](https://github.com/scylladb/nodejs-rs-driver/blob/f4d6a68641bec162f066641b599eb31ec6efc0fa/lib/client.js#L354-L377)
of such values.

#### Clean use for non critical paths

Sometimes we want to return objects with [clear structure](https://github.com/adespawn/nodejs/blob/452f2acd2d8794161a1866c4b336df75c038cd22/src/metadata/host.rs#L5-L12),
where performance is not so critical (think: metadata). In this case helpers defined in [to_napi_obj.rs](../../../src/utils/to_napi_obj.rs) come to play.
They allow you to convert:

- Rust structs and enums with values in variants to JS
- Rust maps (String -> Any) into JS objects

Details on how to use them are present in the code docs for that file.
Those helpers are a specialized replacement for [napi-rs classes](https://napi.rs/docs/concepts/class).
They provide slightly better performance than napi-rs classes (since they do a bit less stuff on the returned object) and a reasonable user interface.

### From Napi Value

Similar to the previous section, we have helpers for converting JS objects to Rust structs. To see more, go to [from_napi_obj.rs](../../../src/utils/from_napi_obj.rs).
This macro provides a much cleaner interface than [napi-rs classes](https://napi.rs/docs/concepts/class).
Compared to napi-rs classes, it allows you to convert arbitrary JS objects with the desired structure, rather than only objects created through the napi-rs layer.

When using structs from this macro, all fields are converted from JS to Rust. This means that when you have a struct with a high number of fields but use only a few of them,
you will still pay the cost of converting all unused fields.

### Casync (async bridge)

This is an open improvement that attempts to cut the very high CPU cost of synchronization in async functions.
You can see the benchmarks for this feature in [#414](https://github.com/scylladb/nodejs-rs-driver/pull/414).
TODO: finish this section once #414 is merged.

### JSResults

We use a custom JSResult for results that may end with an error. This replaces napi-rs Results, as those do not allow for custom errors.
We need custom errors since the errors returned by the Rust driver contain additional information. For now we just pass the error name.
We then need to use JSResult over regular Result since we cannot implement the ToNapiValue trait on a regular Result.
This complicates the code slightly but is the solution we found with the lowest verbosity.

## The napi problem

The napi-rs library is not perfect. We have already [found and fixed](https://github.com/napi-rs/napi-rs/issues?q=author%3Aadespawn) multiple bugs in the library.
The library is developed with heavy LLM usage. The quality and readability of the code in some places is less than ideal.
However, this is still the best option we have. To reduce the impact of problems with the napi-rs code, we avoid using high-abstraction parts of napi-rs,
and where possible switch to self-written, specialized abstractions.
