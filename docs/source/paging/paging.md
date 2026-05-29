# Fetching Large Result Sets

When dealing with a large number of rows, the driver breaks the result into *pages*,
only requesting a limited number of rows at a time (`5000` is the default `fetchSize`).
Use one of the paging mechanisms below to retrieve results beyond a single page.
Paging is enabled by default.

> **Warning:** Issuing unpaged SELECTs may have severe performance consequences:
>
> - The cluster may experience high load.
> - Queries may time out.
> - The driver may consume large amounts of memory.
> - Latency will likely spike.
>
> **Always page your SELECTs.**

## Automatic Paging

### Async Iterators

The driver supports asynchronous iteration of a `ResultSet` using the built-in
[Async Iterator](https://github.com/tc39/proposal-async-iteration),
fetching subsequent pages automatically as the previous one is consumed.

Use the [`for await...of`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/for-await...of)
statement to iterate over large result sets:

```javascript
const result = await client.execute(query, params, { prepare: true });

for await (const row of result) {
  console.log(row[columnName]);
}
```

The driver initially fetches the first page when `execute()` is called (up to `fetchSize` rows).
If there are additional rows, the driver fetches the next page automatically as the async iterator
yields rows from the previous page.

Use the `isPaged()` method on a `ResultSet` instance to check whether more pages exist.

> **Warning:** The sync and async iterators and the `rows` property are **mutually exclusive**.
> Use only one of the following per `ResultSet` instance:
>
> - `result.rows` — contains only the rows of the first page.
> - Sync iterator — yields all rows in the current page.
> - Async iterator — yields all rows across all pages.

### Each Row Callback

Use `eachRow()` to process each row as it arrives.
It operates in two modes, controlled by `QueryOptions.autoPage`:

- **Automatic paging** (default): fetches all pages until all rows are processed.
- **Manual paging**: fetches one page at a time; call `result.nextPage()` to fetch the next page.

`eachRow()` invokes:

- `rowCallback(rowIndex, row)` for each row as soon as it is received.
- `callback(err, result)`:
  - When `autoPage` is `true`: after all pages are fetched and all rows processed.
  - When `autoPage` is `false`: after each page is fetched.
  - On error.

```javascript
client.eachRow(
  query,
  parameters,
  { prepare: true, autoPage: true },
  function (rowIndex, row) {
    // process row
  },
  function (err, result) {
    if (err) {
      // handle error
      return;
    }
    if (result.nextPage) {
      // Manual paging only: fetch the next page.
      result.nextPage();
    } else {
      // All pages consumed.
    }
  }
);
```

### Row Streams

Use `client.stream()` to handle a large result set as a
[Stream](https://nodejs.org/api/stream.html) of rows.
The driver automatically fetches following pages, yielding rows as they arrive
and retrieving the next page only after the previous rows are read (throttling).

```javascript
client.stream(query, parameters, options)
  .on("readable", function () {
    let row;
    while ((row = this.read())) {
      // process row
    }
  })
  .on("end", function () {
    // all rows have been retrieved
  });
```

## Manual Paging

To save paging state and resume later (for example, for stateless web pagination),
the driver exposes a `pageState` that represents the position in the result set
when the last page was fetched.

Fetch the first page and save the state:

```javascript
const options = { prepare: true, fetchSize: 1000 };
const result = await client.execute(query, parameters, options);

const rows = result.rows; // first page (up to 1000 rows)
let pageState = result.pageState;
```

Use the saved `pageState` to continue from where you left off:

```javascript
const options = { pageState, prepare: true, fetchSize: 1000 };
const result = await client.execute(query, parameters, options);

const rows = result.rows; // next page
pageState = result.pageState;
```

> **Note:** Manual paging works well for sequential navigation (next page / previous page),
> but does not support arbitrary jumps (e.g., "go directly to page 10"),
> because each page's `pageState` depends on the previous page.

> **Warning:** The page state token can be manipulated to retrieve other results within the same
> column family. Do **not** expose raw `pageState` tokens to end users.

## Best Practices

| Approach | Unpaged | Manual paging | Automatic paging |
|----------|---------|---------------|-----------------|
| Client API | `execute` (`paged: false`) | `execute` with `pageState` | Async iterators, `eachRow`, `stream` |
| Working | All results in a single CQL frame | One page per CQL frame | Multiple frames, transparent iteration |
| Cluster load | Potentially **HIGH** for large results | Normal | Normal |
| Memory footprint | Potentially **LARGE** — all results at once | Small — one page at a time | Small — constant number of pages |
| Latency | Potentially **HIGH** — all results at once | Noticeable on page boundaries | Noticeable on page boundaries |
| Suitable for | Non-SELECTs; SELECTs with LIMIT (few rows) | Advanced use cases requiring page control | All SELECTs in general |
