# Query options overview

When a user provides options for a given query, an ``ExecutionOptions`` object is created.
Before using these options in the Rust part of the driver, they are converted to ``QueryOptionsWrapper``.

Because creation of those options requires a number of native calls,
the process of converting execution options from Node to Rust part is time-consuming.

## Query options reusing

To reduce the performance impact of creating identical options instances,
for the ``executeConcurrent`` interface, driver reuses a single instance of ``ExecutionOptions``
and the corresponding Rust ``QueryOptionsWrapper``. This is possible because, by design,
each of the queries provided to ``executeConcurrent`` is executed with the same options.

``ExecutionOptions`` are created at the construction of ``ArrayBasedExecutor`` and ``StreamBasedExecutor``,
and are used for each of the queries done inside given instance of executor. Afterwards, those options
are dropped with the rest of the information associated with given executor.

This is currently limited to a single call of ``executeConcurrent``,
meaning new instance of ``ExecutionOptions`` is created for each call to ``executeConcurrent``.
