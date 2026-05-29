# Data Types and Type Mapping

This page covers how JavaScript values map to CQL types, and how to
specify types explicitly when the driver cannot infer them automatically.

## Type Guessing

When executing an **unprepared** statement, the driver attempts to infer the CQL type
from the JavaScript value passed. This is called *type guessing*.

Type guessing works well for simple types but may fail for complex types, or when
multiple JavaScript representations map to different CQL types (e.g., a string that
looks like a UUID).

The following table shows which JavaScript values can be guessed for each CQL type:

| CQL type | Recognized JavaScript value |
|----------|-----------------------------|
| Ascii, Text | `String` (except strings matching UUID regex) |
| BigInt, Counter | `Long` (from the `long` package) |
| Boolean | `boolean` |
| Blob | `Buffer` (already serialized) |
| Decimal | `BigDecimal` (exposed by this driver) |
| Double | `Number` |
| Date | `LocalDate` (exposed by this driver) |
| Duration | `Duration` (exposed by this driver) |
| Float, Int, SmallInt, TinyInt | *Cannot be guessed* |
| Timestamp | `Date` |
| Inet | `InetAddress` (exposed by this driver) |
| List, Set | `Array` |
| Map | *Cannot be guessed* |
| UDT | *Cannot be guessed* |
| Time | `LocalTime` (exposed by this driver) |
| Uuid, TimeUuid | Any string matching UUID regex, or `Uuid` class |
| Tuple | `Tuple` (exposed by this driver) |
| Varint | `Integer` (exposed by this driver) |

> **Note:** In prepared statements, all type hints are **ignored** — the driver uses the
> type metadata received from the database at preparation time.

## Type Hints

When the driver cannot guess the type, or when you want to override the guessed type,
you can provide a *type hint* alongside the value.

Type hints are passed in the `hints` array of `QueryOptions`, with one entry
per parameter (`null` or omitted entries use type guessing for that parameter):

```javascript
await client.execute(
  "INSERT INTO t (id, val) VALUES (?, ?)",
  [id, someValue],
  { hints: ["uuid", "int"] }
);
```

### Text Representation

Pass a string describing the CQL type:

```
"timestamp"
"list<int>"
"map<text, boolean>"
"tuple<int, boolean>"
"udt<name_of_the_udt>"
"vector<float, 7>"      // for vectors: element type, then dimension
```

> **Note:** A partial hint (e.g., `"map"` without subtypes) causes the driver to attempt
> to guess the subtypes. A partially-specified complex type (key type specified,
> value type omitted) is **not valid**.

A hint is considered **full** when it specifies either a simple type (like `int` or `date`),
or a complex type with all its subtypes specified. A hint is **partial** if it defines a
complex type without specifying hints for its subtypes. When a partial hint is provided,
the driver attempts to guess the remaining subtypes.

### Object Representation

Due to the complexity of object hints, the text representation is recommended.
However, if needed, you can provide a hint as an object:

```javascript
{
  code: number,           // A value from types.dataTypes enum
  info: typeInfo?,        // Additional type info for complex types
  customTypeName: string? // Required when code is dataTypes.custom
}
```

The `code` property should be a value from the [`types.dataTypes` enum](https://github.com/scylladb/nodejs-rs-driver/blob/main/lib/types/index.js).
The `info` property depends on the type:

| Type | `info` value |
|------|-------------|
| Simple types | `null` or omitted |
| List, Set | A type hint object for the element type |
| Map | `[keyTypeHint, valueTypeHint]` |
| Tuple | Array of type hint objects, one per element |
| UDT | Object of `UdtColumnInfo` type |
| Vector | `[elementTypeHint, dimension]` where dimension is a number |

Examples:

```javascript
// Equivalent to "int"
const intHint = { code: 0x9 /* types.dataTypes.int */ };

// Equivalent to "map<text, boolean>"
const mapHint = {
  code: 0x21 /* types.dataTypes.map */,
  info: [
    { code: 0xa /* types.dataTypes.text */ },
    { code: 0x4 /* types.dataTypes.boolean */ },
  ],
};

// Equivalent to "vector<float, 3>"
const vectorHint = {
  code: 0x0 /* types.dataTypes.custom */,
  customTypeName: "vector",
  info: [{ code: 0x8 /* types.dataTypes.float */ }, 3],
};
```

## Serialized Values

You can pass an already-serialized CQL value as a
[Buffer](https://nodejs.org/api/buffer.html#buffer).
This is not generally recommended unless you are implementing a custom encoder
or already have serialized values available.

## Driver-Provided Types

The following types are exposed by the driver under `require("scylladb-driver-alpha").types`:

| Class | CQL type |
|-------|----------|
| `Uuid` | `uuid` |
| `TimeUuid` | `timeuuid` |
| `LocalDate` | `date` |
| `LocalTime` | `time` |
| `Duration` | `duration` |
| `BigDecimal` | `decimal` |
| `InetAddress` | `inet` |
| `Integer` | `varint` |
| `Tuple` | `tuple<...>` |

Access them via:

```javascript
const { types } = require("scylladb-driver-alpha");

const id = types.Uuid.random();
const today = new types.LocalDate(2024, 1, 15);
const t = new types.Tuple(1, "hello", true);
```
