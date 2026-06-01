<!-- This document is heavily based on the DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/features/paging/index.html
and rust driver documentation:
https://rust-driver.docs.scylladb.com/stable/statements/paged.html -->

# Fetching large result sets

When dealing with a large number of rows, the driver breaks the result into _pages_, only requesting a limited number of
rows each time (`5000` being the default `fetchSize`). To retrieve the rows beyond this default size, use one of the
following paging mechanisms. Paging is enabled by default and you can disable paging by setting `QueryOptions.paged` to false.

:::{warning}
Issuing unpaged SELECTs
may have dramatic performance consequences! **BEWARE!**\
If the result set is big (or, e.g., there are a lot of tombstones), those atrocities can happen:

- cluster may experience high load,
- queries may time out,
- the driver may devour a lot of RAM,
- latency will likely spike.

Stay safe. Page your SELECTs.
:::

## Automatic paging

### Async iterators

The driver supports asynchronous iteration of the `ResultSet` using the built-in [Async Iterator][async-it], fetching
the following result pages after the previous one has been yielded.

Large result sets can be iterated using the [`for await ... of`][for-of-await] statement:

```javascript
const result = await client.execute(query, params, { prepare: true });

for await (const row of result) {
  console.log(row[columnName]);
}
```

Under the hood, the driver will get all the rows of the query result using multiple requests. Initially,
when calling `execute()` it will retrieve the first page of results according to the fetch size (defaults to `5000`).
If there are additional rows, those will be retrieved once the async iterator yielded the rows from the previous page.

If needed, you can use `isPaged()` method of `ResultSet` instance to determine whether there are more pages of results
than initially fetched.

:::{warning}
Note that using either the async or sync iterators will not affect the internal state of the `ResultSet` instance.
The following methods are mutually exclusive, so you should use only one per ResultSet instance:

- rows property, which contains the row instances of the first page of results,
- sync iterator, which will yield all the rows in the current page,
- async iterator, which will yield all the rows in the result regardless of the number of pages.
:::

### Each row callback

You can also iterate through pages by setting a per-page callback.
`eachRow()` works in two modes, depending on the `QueryOptions.autoPage` configuration:

- automatic paging: keeps fetching pages until all rows are processed (this is the default mode),
- manual paging: fetches one page at a time. This mode gives you access to result sets of intermediate pages.
  To fetch the next page, you need to call `result.nextPage()`.

`eachRow()` calls:

- `rowCallback(rowIndex, row)` for each row as soon as it is received,
- `callback(err, result)`:
  - when `autoPage` is set to true: after all pages are fetched and `rowCallback` was called for each row,
  - when `autoPage` is set to false: after the current page is fetched and `rowCallback` was called for each row,
  - when an error occurs.

```javascript
client.eachRow(
  query,
  parameters,
  { prepare: true, autoPage },
  (rowIndex, row) => {
    // process row
  },
  (err, result) => {
    if (err) {
      // handle error
      return;
    }
    if (result.nextPage) {
      // Handle intermediate page result set. This branch will be taken only when autoPage is disabled.
      // When autoPage is enabled you will not have access to those result sets.
      result.nextPage();
    } else {
      // Handle last page result.
    }
  }
);
```

### Row streams

If you want to handle a large result set as a [`Stream`][stream] of rows, you can use `stream()` method of the
`Client` instance. The `stream()` method automatically fetches the following pages, yielding the rows as they come
through the network and retrieving the following page only after the previous rows were read (throttling).

```javascript
client.stream(query, parameters, options)
  .on('readable', function () {
    // readable is emitted as soon as a row is received and parsed
    let row;
    while (row = this.read()) {
      // process row
    }
  })
  .on('end', function () {
    // emitted when all rows have been retrieved and read
  });
```

## Manual paging

Sometimes it is convenient to save the paging state in order to restore it later. For example, consider a stateless
web service that displays a list of results with a link to the next page. When the user clicks that link, we want to
run the exact same query, except that the iteration should start where we stopped on the previous page.

To do so, the driver exposes a `pagingState` object that represents where we were in the result set when the last page
was fetched:

```javascript
const options = { prepare: true, fetchSize: 1000 };
const result = await client.execute(query, parameters, options);

// Property 'rows' will contain only the amount of items of the first page (max 1000 in this case)
const rows = result.rows;

// Store the page state
let pageState = result.pageState;
```

In the next request, use the `pageState` to fetch the following rows.

```javascript
// Use the pageState in the queryOptions to continue where you left it.
const options = { pageState, prepare: true, fetchSize: 1000 };
const result = await client.execute(query, parameters, options);

// Following rows up to fetch size (1000)
const rows = result.rows;

// Store the next paging state.
pageState = result.pageState;
```

Saving the paging state works well when you only let the user move from one page to the next. But it doesn't allow
arbitrary jumps (like "go directly to page 10"), because you can't fetch a page unless you have the paging state of the
previous one. Such a feature would require offset queries, which are not natively supported by ScyllaDB and Apache Cassandra.

**Note**: The page state token can be manipulated to retrieve other results within the same column family, so it is not
safe to expose it to the users in plain text.

## Best practices

| Query result fetching   | Unpaged                                                                                                                 | Paged manually                                                                                       | Paged automatically                                                                               |
|-------------------------|-------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| Exposed Client API      | `execute` with `QueryOptions.paged = false`                                                                             | `execute` with `QueryOptions.pageState`                                                              | Async iterators, each row callbacks, streams                                                      |
| Working                 | get all results in a single CQL frame, into a single result set                                                         | get one page of results in a single CQL frame, into a single result set                              | upon high-level iteration, fetch consecutive CQL frames and transparently iterate over their rows |
| Cluster load            | potentially **HIGH** for large results, beware!                                                                         | normal                                                                                               | normal                                                                                            |
| Driver overhead         | low - simple frame fetch                                                                                                | low - simple frame fetch                                                                             | low - simple frame fetch                                                                          |
| Driver memory footprint | potentially **BIG** - all results have to be stored at once!                                                            | small - only one page stored at a time                                                               | small - at most constant number of pages stored at a time                                         |
| Latency                 | potentially **BIG** - all results have to be generated at once!                                                         | considerable on page boundary - new page needs to be fetched                                         | considerable on page boundary - new page needs to be fetched                                      |
| Suitable operations     | - in general: operations with empty result set (non-SELECTs)</br> - as possible optimisation: SELECTs with LIMIT clause | - for advanced users who prefer more control over paging                                             | - in general: all SELECTs                                                                         |

[stream]: https://nodejs.org/api/stream.html
[async-it]: https://github.com/tc39/proposal-async-iteration
[for-of-await]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of
