# Miscellaneous stuff

## DataStax API

DSx driver had some external APIs that were related to DSx-specific features:

- Custom auth providers
- The entire datastax & geometry modules
- Some client / query options

How did we handle those?

For functions/methods, we implemented stubs in JS code:

```js
/**
 * @deprecated Not supported by the driver. Usage will throw an error.
 */
class Vertex {
    constructor() {
        throwNotSupported("Vertex");
    }
}
```

See [`structure.js`](../../../lib/datastax/graph/structure.js). The goal of those stubs is to loudly inform
JS users of the driver that our driver does not support those features. This approach, while good for users transitioning
from the old DSx driver, may provide some unnecessary noise for new users. When stabilizing the API in 1.0, those
stubs can be removed, with proper documentation for transitioning users. (If there is such a need,
you could create a temporary transition version for users transferring from the DSx driver, with those stubs enabled).

For the TS users of the driver, it was enough to remove those endpoints from the TS files.
When someone attempts to use those features, they will get a compilation error,
meaning we achieved the goal of explicitly informing the user of the deprecation of those endpoints.

When it comes to no longer supported options, we have a very similar approach:
When a JS user provides a no-longer-supported option,
[we throw an error](https://github.com/adespawn/nodejs/blob/ee439f78ed4b4e6c0a73b8aa2f649e45493ae1c5/lib/client-options.js#L971-L978).
Those options are not mentioned in documentation, avoiding the noise for new users.
When it comes to TS users, deleting those options from the TS API is again enough.

## Personal vendettas

Well, maybe not exactly personal, but still. This list is composed of small and big annoyances with the current state of the driver.

### API overloads

```js
     * @example <caption>Overloads</caption>
     * client.eachRow(query, rowCallback);
     * client.eachRow(query, params, rowCallback);
     * client.eachRow(query, params, options, rowCallback);
     * client.eachRow(query, params, rowCallback, callback);
     * client.eachRow(query, params, options, rowCallback, callback);
```

From this [piece of code](https://github.com/adespawn/nodejs/blob/ee439f78ed4b4e6c0a73b8aa2f649e45493ae1c5/lib/client.js#L418-L423).

Allowing for overloading API in this way is (while perfectly fine by JS standards) very annoying when it comes to ensuring type safety.
We have to guess based on the value types what overload the user is providing us with. But touching it will break the API.
Is someone using those overloads? Idk. Will it be hard for users to remove usages of those overloads? Probably not.
Feel free to re-visit this when creating 1.0.

### Long

The driver was initially developed when BigInt [was not a thing](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt#browser_compatibility).
This means there are internal (and external) parts of the driver that use [Long](https://www.npmjs.com/package/long).
This is the only JS dependency (excluding development dependencies) that the driver uses.
While internal pruning of Long should be (probably annoying but still) possible, removing it from external parts of the driver
may break some APIs. There is an issue related to this: [#41](https://github.com/scylladb/nodejs-rs-driver/issues/41).
This topic would need to be re-visited before 1.0. You would have to decide how to approach this: keep Long as a legacy part of the API,
or fully remove it?
