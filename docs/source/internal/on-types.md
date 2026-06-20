# Some rambling on JS types

JavaScript allows calls to this library with arbitrary argument values.
In general using this driver API with values of types different than described in the documentation
(JS Docs) can be considered UB.

Within JavaScript Objects we allow for some duck-typing - this applies to all of the config options and named parameters.
Any object passed there that has required fields is considered valid.
There are some exceptions where we rely on aspects of the objects other than the field being present.

- Policies: In policies we expect objects with specified constructors. This means you have to use objects as provided through the driver.
- Type guessing & encoding: Parts of type guessing and encoding depend on receiving values of specified types.

When it comes to built-in types, we may perform some explicit checks to ensure you have provided expected built-in types.

In general, there is no specific policy on allowing duck-typing: in many places like configuration it's allowed, but there are exceptions,
such as the above-mentioned policies.

## TS fixes something, but exposes you to other problems

When you call a TS function from JS code, you can NOT assume that someone will call it with the types as specified in TS.
You can only assume this is what the function should accept and correctly handle.
When calling internally with wrong types, consider it a bug.
When calling it internally, but with wrong types provided by the user, consider it the same as direct calls from the user with different types: undefined behavior.
Either way try to gracefully handle those cases. Clear errors (remember, napi will complain when receiving invalid types: [#251](https://github.com/scylladb/nodejs-rs-driver/issues/251)),
or where possible allow for duck-typing (i.e. don't explicitly disallow it where it makes sense).
