<!-- This document is heavily based on the DSx driver documentation:
https://docs.datastax.com/en/developer/nodejs-driver/4.8/features/parameterized-queries/index.html -->

# Parameterized queries

You can bind the values of parameters in a statement either by _position_ or by using _named_ markers.

## Positional parameterized statements

When using positional parameters, the query parameters must be provided as an Array.

```javascript
const statement = 'INSERT INTO artists (id, name) VALUES (?, ?)';
// Parameters by marker position
const params = ['krichards', 'Keith Richards'];
await client.execute(statement, params, { prepare: true });
```

## Named parameterized statements

You declare the named markers in your queries and use JavaScript object properties to define the parameters, with
the `Object` property names matching the parameter names.

```javascript
const statement = 'INSERT INTO artists (id, name) VALUES (:id, :name)';
// Parameters by marker name
const params = { id: 'krichards', name: 'Keith Richards' };
await client.execute(statement, params, { prepare: true });
```

Named parameters are case-insensitive.

Currently named parameters are supported only in prepared statements.
