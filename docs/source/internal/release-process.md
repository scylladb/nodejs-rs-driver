# Release process

Currently we have support for n=2 platforms. This limitation for specific platforms comes from the need to compile and test a given platform in CI.
We have n+1 npm packages. 1 general package with all of the JS code, and additional packages 1 per each platform:

- [Main package](https://www.npmjs.com/package/@scylladb/driver)
- [Linux x64 platform package](https://www.npmjs.com/package/@scylladb/driver-linux-x64-gnu)
- [Linux Arm platform package](https://www.npmjs.com/package/@scylladb/driver-linux-arm64-gnu)

## Adding a new package

To release a new package, follow npm documentation. Once the package is added, add support for [trusted publishing](https://docs.npmjs.com/trusted-publishers).
DO NOT USE tokens/keys for releasing through CI. You may use those only for the first version release.
What I have done to release a new package is create an empty index.js and package.json:

```json
{
    "name": "@scylladb/driver-linux-arm64-gnu",
    "version": "0.0.0",
    "description": "",
    "license": "Apache-2.0",
    "repository": {
        "type": "git",
        "url": "https://github.com/scylladb/nodejs-rs-driver"
    }
}
```

Release it through npm cli (see documentation) to add it to npm registry. After that it becomes visible on the npm side, and you can set it up from there.
