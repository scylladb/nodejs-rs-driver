# Unprepared statements

Whenever you want to execute statements without their prior preparation, you need to inform the driver what the inserted data is.
There are multiple ways you can achieve that:

1. passing recognizable types,
2. passing a _type hint_ alongside the value,
3. passing already serialized values.

## Recognizable types

When you pass a value of a specific type, the driver will attempt to guess the type of the value
that should be inserted into the database. This is also known as **type guessing**.
While this is useful for simple types, this may not work properly with more advanced types,
or multiple types that look the same in JS but are encoded differently in CQL protocol (undesired unification).

Here you can find for each CQL type, what JS values can be used to represent given type and be guessed:
<!-- TODO: In some place list all accepted types without type guessing -->

- Ascii, Text:
  - [String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String) (except strings that match UUID regex).
    Please note that when using type guessing all the strings will be encoded with utf-8 encoding.
- BigInt, Counter:
  - [Long](https://www.npmjs.com/package/long) class
  <!-- Internal note. BigInt is not guess into any type. Maybe add guessing for that? -->
- Boolean:
  - [boolean](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean)
- Blob:
  - Blobs can be encoded only from Buffer, which formally is already a serialized value
- Decimal:
  - BigDecimal class (class exposed by this driver)
- Double:
  - [Number](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number)
- Date:
  - LocalDate class (class exposed by this driver)
- Duration:
  - Duration class (class exposed by this driver)
- Float, Int, SmallInt, TinyInt:
  - It's not possible to guess those types  
- Timestamp:
  - [Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date)
- Inet:
  - InetAddress class (class exposed by this driver)
- List, Set:
  - [Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
- Map:
  - It's not possible to guess this type
- UDT:
  - It's not possible to guess this type
- Time:
  - LocalTime class (class exposed by this driver)
- Uuid, TimeUuid:
  - any string matching Uuid regex
  - Uuid class (class exposed by this driver)
- Tuple:
  - Tuple class (class exposed by this driver)
- Varint:
  - Integer class (class exposed by this driver)

## Type hints

Sometimes you might want to use CQL types which cannot be guessed,
or use one of the value formats you cannot use for guessing.
One example is that you are passing a string that matches uuid regex.
It would be guessed as uuid CQL type, so if you want to pass it as a CQL string (Text or Ascii),
you need another way: you can provide _a type hint_. With the type hint, you provide the desired CQL type of the value,
which allows to properly serialize the value into CQL protocol format.

There are two supported formats of providing type hints:

- Text representation,
- Object representation.

### Text representation

You can provide a string containing the type of the value. Examples:

- `timestamp`,
- `list<int>`,
- `map` (this is a _partial hint_!),
- `tuple<int, boolean>`, `udt<name_of_the_udt>`,
- `vector<float, 7>` (for vectors, first provide type, then dimension).

### Object representation

Due to the complexity of this form of hint representation, we recommend using text representation of the type hints.

You can provide a type hint as an object with the following structure:

```javascript
{
  code: number,             // A variant of types.dataTypes enum
  info: type_info?,         // Additional type information (necessary for complex types: see bellow)
  customTypeName: string?   // Type name (necessary when code is set to dataTypes.custom)
}
```

The `code` property should represent the base type of the value - you can find possible values in the
[`types.dataTypes`](https://github.com/scylladb/nodejs-rs-driver/blob/0342b6789b59106ce3d9d2964fd27514a0b42d68/lib/types/index.js#L93-L121).

The `info` property depends on the type:

| Type                                    | `info` value                                                         |
|-----------------------------------------|----------------------------------------------------------------------|
| Simple types (int, text, boolean, etc.) | `null` or omitted                                                    |
| List, Set                               | A type hint object for the element type                              |
| Map                                     | An array of two type hint objects: `[keyType, valueType]`            |
| Tuple                                   | An array of type hint objects, one for each element                  |
| UDT                                     | Object of UdtColumnInfo type                                         |
| Vector                                  | An array: `[elementTypeHint, dimension]` where dimension is a number |

See the [type definitions](https://github.com/scylladb/nodejs-rs-driver/blob/0342b6789b59106ce3d9d2964fd27514a0b42d68/lib/encoder.js#L22-L32) for more detailed information
on how info field should look like.

#### Examples

```javascript
// equivalent to `int`
const intHint = { code: 0x9 /* types.dataTypes.int */ }; 

// equivalent to `map<text, boolean>`
const mapHint = { 
  code: 0x21 /* types.dataTypes.map */, 
  info: [
    { code: 0xa /* types.dataTypes.text */ },
    { code: 0x4 /* types.dataTypes.boolean */ }
  ] 
};

// equivalent to `vector<float, 3>`
const vectorHint = { 
  code: 0x0 /* types.dataTypes.custom */, 
  customTypeName: "vector",
  info: [{ code: 0x8 /* types.dataTypes.float */ }, 3] 
};
```

____

Hints can be provided for all or only some of the parameters.  
A hint can be full or partial. A hint is considered _full_ when  
it specifies either:  

- a simple type (like int or date),  
- or a complex type (like a list or a map) with all its subtypes specified.  
A hint is considered _partial_ if it defines a complex type without  
specifying hints for its subtypes.  
A complex type hint with hints provided for only some subtypes — such as specifying  
the type of map keys but not the values — is not considered a valid hint.  
When a partial hint is provided, the driver attempts to guess the remaining part of the value's type.  

In prepared statements any hints you provide will be ignored.

## Serialized values

It's possible to pass an already serialized value as a [Buffer](https://nodejs.org/api/buffer.html#buffer).
Normally, this is not recommended unless you want to write your own encoder.
This might be a viable way if you, for some reason, have already serialized CQL values at hand.
