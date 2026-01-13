# Unprepared statements

Whenever you don't want to execute prepared statements, you need to inform the driver what the inserted data is.
There are multiple ways you can achieve that:

1. passing recognizable types,
2. passing the value, alongside the type hint,
3. passing already serialized values.

## Recognizable types

When you pass a value of a specific type, the driver will attempt to guess the type of the value,
that should be inserted to the database. This is also known as **type guessing**.
While this is useful for simple types, this may now work properly,
when using more advanced, or types that look the same in JS but are encoded differently in CQL protocol.

Here you can find for each CQL type, what JS values can be used to represent given type and be guessed:
<!-- TODO: In some place list all accepted types without type guessing -->

- Ascii, Text:
  - [String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String) (except strings that match UUID regex). Please note that when using type guessing all the strings will be encoded with utf-8 encoding.
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
- Float, Int, SmallInt, TinyInt
  - It's not possible to guess those types  
- Timestamp
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
  - string matching Uuid regex
  - Uuid class (class exposed by this driver)
- Tuple:
  - Tuple class (class exposed by this driver)
- Varint
  - Integer class (class exposed by this driver)

## Type hints

Whenever you want to use types that cannot be guessed, or use one of the formats you cannot use for guessing,
you can provide a type hint. With the type hint, you provide the desired CQL type of the value,
that allows to properly serialize the value into proper CQL format.

There are two supported formats of providing type hints:

- Text representation,
- Object representation.

### Text representation

You can provide a string containing the type of the value, for example:
`timestamp`, `list<int>`, `map` (this is a partial hint), `tuple<int, boolean>`, `udt<name_of_the_udt>`

### Object representation

...

____

Hints can be provided for all, or only some of the parameters.
A hint can be full, or partial. A hint is considered full when
it specifies either a simple type (like int or date) or a complex type (like a list or a map) with
all of its subtypes specified. A hint is considered partial if it defines a complex type without
specifying hints for its subtypes. Providing hints for only some subtypes — such as specifying
the type of map keys but not the values — is not considered a valid hint.
When a partial hint is provided, the driver attempts to guess the remaining part of the type
of that value.

In prepared statements any hints you provide will be ignored.

## Serialized values

While it's possible to pass already serialized value, as a [Buffer](https://nodejs.org/api/buffer.html#buffer),
this is not recommended, unless you want to write your own encoder.
