# Unprepared statements

Whenever you don't want to execute prepared statements, you need to inform the driver what the inserted data is.
There are multiple ways you can achieve that:

1. passing already serialized values,
2. passing recognizable types,
3. passing the value, alongside the type hint.

## Serialized values

While it's possible to pass already serialized value, as a [Buffer](https://nodejs.org/api/buffer.html#buffer),
this is not recommended, unless you want to write your own encoder.

## Recognizable types

When you pass a value of a specific type, the driver will attempt to guess the type of the value,
that should be inserted to the database. This is also known as **type guessing**.
While this is useful for simple types, this may now work properly,
when using more advanced, or types that look the same in JS but are encoded differently in CQL protocol.

Here you can find for each type, what values can be used for each of the CQL types:

- Ascii, Text:
  - [String](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String) (except strings that match UUID regex). Please note that when using type guessing all the strings will be encoded with utf-8 encoding.
- BigInt, Counter:
  - [Long](https://www.npmjs.com/package/long) class
  <!-- Internal node. BigInt is not guess into any type. Maybe add guessing for that? -->
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

Whenever you want to use types that cannot be guessed, or use one of the formats you cannot use for guessing, you can provide a type hint. With the type hint, you provide the desired CQL type of the value, that allows to properly desire the value into proper CQL format. There are two supported formats of providing type hints:

- Text representation:
    You can provide 
