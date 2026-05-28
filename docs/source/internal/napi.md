# Napi (and napi-rs)

## Distinction

Node-API and napi-rs are two different things. When encountering just "napi" **in the documentation** (or PRs/issues),
what is meant in most cases is Node-API (although there may be some exceptions, especially in old docs).
However, when you encounter napi **in the code** (mostly Rust code, the napi crate), this refers to napi-rs.

In napi-rs there are different kinds of interfaces. Some of the interfaces napi-rs exposes are just 1-to-1 mappings from Node-API (mostly `napi::sys`).
Then there are low-cost abstractions over Node-API, like `(To/From)NapiValue` traits and `napi::Env`.
Then there are high-cost interfaces. Some of those add overhead that we would anyway need to introduce (like **sync** functions: functions with the `#[napi]` macro).
Others add significant overhead that we can avoid by using lower-abstraction-level approaches to achieve sometimes very significant performance improvements.
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

## Typing

When you pass values between JS and Rust it's nice to have it typed in some way, to improve both readability and correctness of the code.
When using napi-classes or node-built in type representations (integers, bigInt, arrays, `Result`*, strings, buffers), in regular sync function,
Napi-rs will generate type annotations correctly in the `index.d.ts` file upon compilation of the code.

\* result type is not "visible" across, since napi-rs does not annotate what the function can throw, but is properly handled as a passthrough type.

However, when using either custom (To/From)NapiValue implementation, one of the helper macros or casync functions, you will need to do a bit more work to properly annotate the types.
Generally there are two things you need to do, in order to properly annotate those uses. What you need to do depends on the case.

- [`custom-types.d.ts`](../../../src/custom-types.d.ts): This file defines custom types. This means when you define new type, that you accept as argument or return from rust function,
    and it is **not** napi-class, you have define its JS(TS) type there.
    This file will then tell the JS/TS parser what does the magic type annotated in Rust function ex. `PagingResultWithExecutor` means.

    So in the Rust code you just return `PagingResultWithExecutor`:

    ```rs
    // Simple version
    #[napi]
    pub async fn query_single_page_encoded(
        &self,
        ...
    ) -> Result<PagingResultWithExecutor> {


    // Full version with manual type override (see next point)
    #[napi(ts_return_type = "Promise<PagingResultWithExecutor>")]
    pub async fn query_single_page_encoded(
        &self,
        ...
    ) -> JsResult<PagingResultWithExecutor> {
    ```

    Napi-rs then annotates the TS definition of this function as returning `PagingResultWithExecutor`:

    ```ts
    export declare class SessionWrapper {
        ...
        querySinglePage(...): Promise<PagingResultWithExecutor>
    }
    ```

    The custom definition in the `custom-types.d.ts`:

    ```ts
    export type PagingResultWithExecutor = [PagingStateWrapper | null, QueryResultWrapper, QueryExecutor]
    ```

    provides the meaning for this type. This is something you need to add manually to `custom-types.d.ts` file
    for every new type you add. This file will then be prepended to `index.d.ts` (used by JS/TS engine when parsing types in VScode) at the rust compilation time.

    Note: this could be possibly automated with `pub trait TypeName` napi-rs trait.
- Manual type overrides: When the napi-rs cannot properly deduce the JS name, you need to manually override the type in the endpoint that utilize it.
    By default, when you have a type `T` in Rust, and you were to have rust function return value of that type, it will be annotated in TS as `T`.
    Similarly, if you have a generic type: `G<T>` it will be annotated as `G<T>` in TS.

    Here comes the problem: We have a type `JsResult<T>`, which should be opaque (the same way regular `Result<T>` is opaque) - meaning it should be annotated as
    `T` in TS (instead of the default `JsResult<T>`). Unfortunately you cannot handle it automatically.

    To properly annotate such functions you need to use napi-rs `ts_return_type` for every function that returns such type.
    When using this tag, you need to specify the full type like this: `#[napi(ts_return_type = "Promise<PagingResult>")]`
    (meaning you need to remember about Promise part for async functions).

    It's annoying, but allows to properly annotate the functions.
    You can see me question about this feature on the [napi-rs server](https://discord.com/channels/874290842444111882/874290843262021705/1505966134615085088).

## The napi problem

The napi-rs library is not perfect. We have already [found and fixed](https://github.com/napi-rs/napi-rs/issues?q=author%3Aadespawn) multiple bugs in the library.
The library is developed with heavy LLM usage. The quality and readability of the code in some places is less than ideal.
However, this is still the best option we have. To reduce the impact of problems with the napi-rs code, we avoid using high-abstraction parts of napi-rs,
and where possible switch to self-written, specialized abstractions.
