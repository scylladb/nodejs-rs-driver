'use strict';

module.exports = {
    plugins: ['plugins/markdown'],
    opts: {
        destination: "./public/docs",
        // Exclude @package members from the public API documentation.
        // JSDoc renders all access levels except @private by default, so we
        // explicitly list the levels to render and leave "package" out.
        access: ["public", "protected", "undefined"],
    }
}
