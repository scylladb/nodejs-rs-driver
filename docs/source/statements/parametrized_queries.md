<!-- This document is heavily based on the DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/features/parameterized-queries/index.html -->

# Parameterized queries

You can bind the values of parameters in a statement either by _position_ or by using _named_ markers.

## Positional parameterized query

When using positional parameters, the query parameters must be provided as an Array.

```javascript
const query = 'INSERT INTO artists (id, name) VALUES (?, ?)';
// Parameters by marker position
const params = ['krichards', 'Keith Richards'];
client.execute(query, params, { prepare: true });
```

## Named parameterized query

You declare the named markers in your queries and use a JavaScript object properties to define the parameters, with
the `Object` property names matching the parameters names.

```javascript
const query = 'INSERT INTO artists (id, name) VALUES (:id, :name)';
// Parameters by marker name
const params = { id: 'krichards', name: 'Keith Richards' };
client.execute(query, params, { prepare: true });
```

Named parameters are case insensitive.

Currently named parameters are supported only in prepared statements.
