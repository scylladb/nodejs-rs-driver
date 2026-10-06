# Release process

Currently we have support for n=2 platforms. This limitation for specific platforms comes from the need to compile and test a given platform in CI.
We have n+1 npm packages. 1 general package with all of the JS code, and additional packages 1 per each platform:

- [Main package](https://www.npmjs.com/package/@scylladb/driver)
- [Linux x64 platform package](https://www.npmjs.com/package/@scylladb/driver-linux-x64-gnu)
- [Linux Arm platform package](https://www.npmjs.com/package/@scylladb/driver-linux-arm64-gnu)

## Releasing an existing package

The release workflow signs the Git tag using the ScyllaDB Publisher GPG key (`BF4BF97A8D4DF1AA`, full fingerprint `71A6D22711CDB7C2446D21CFBF4BF97A8D4DF1AA`). Store its ASCII-armored private key in the `release-signing` Actions environment secret `RELEASE_GPG_PRIVATE_KEY`, with environment deployments limited to `main`. The tag creation job uses that environment after release checks pass. The repository contains only the public key, which CI uses to verify the pushed tag.

After the release commit is on `main`, run the release workflow with **publish** unchecked to exercise the build, tests, and npm package dry runs. Run it from `main` again with **publish** checked to create the signed tag and publish the packages. The workflow signs the tag only after all release checks pass. A rerun accepts an existing tag only if its signature and target commit match. npm signs published packages with registry signatures and attaches provenance through trusted publishing. The GPG signature covers the Git tag, not the npm tarballs.

## Adding a new package

To release a new package, follow npm documentation. Once the package is added, add support for [trusted publishing](https://docs.npmjs.com/trusted-publishers).
Do not use npm tokens or access keys for releasing through CI. Use trusted publishing instead. Tokens may be used only for the first version of a new package. The GPG private key secret above is used solely to sign the Git tag.
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
