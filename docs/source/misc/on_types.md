# AA

JavaScript does allow you to ignore ignore the call this library with arbitrary values as arguments.
In general using this driver API with values of types different than provided than described in the documentation
(JS Docs) can be considered UB.

Withing JavaScript Objects we allow for some duck-typing - this applies to all of the config options and named parameters.
Any object passed there that has required fields is considered valid.
There are some exceptions, where we rely on some other aspects of the objects, that the field present.

- Policies: In policies we expect objects with specified constructors. This means you have to used objects as provided through the driver.
- Type guessing & encoding: Parts of type guessing and encoding depend on receiving values of specified types.

When it comes to built-in types, we may perform some explicit checks to ensure you have provided expected builtin type.
