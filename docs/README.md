# Documentation

This directory contains the Sphinx documentation for the ScyllaDB Node.js Driver.

API reference pages are generated from JSDoc and embedded into Sphinx using a custom extension.

## Prerequisites

- Python 3.10+
- [Poetry](https://python-poetry.org/)
- Node.js and npm (for JSDoc generation)

## Quick start

```bash
cd docs
make setupenv   # install poetry (once)
make setup      # install Python and npm dependencies
make preview    # build and serve at http://localhost:5500
```

## Build targets

| Command | Description |
|---|---|
| `make dirhtml` | Build the HTML documentation |
| `make preview` | Live-reload development server on port 5500 |
| `make test` | Build with `-W` (warnings as errors) |
| `make multiversion` | Build all branches/tags |
| `make clean` | Remove build output |

## How the API docs work

The API reference combines two tools:

1. **JSDoc** generates HTML pages from the JavaScript source code into `public/docs/`.
2. **Sphinx** builds the final documentation site, embedding the JSDoc content via a custom `jsdoc_content` extension.

### Build pipeline

```
npm run js-doc          JSDoc HTML files in public/docs/
       |
       v
_utils/generate_api_pages.py  RST stub files in source/api/
       |
       v
sphinx-build            Final site in _build/dirhtml/
```

This pipeline runs automatically via `make dirhtml`. You don't need to run individual steps manually.

### RST page generation (`_utils/generate_api_pages.py`)

The script reads the `<nav>` from JSDoc's `index.html` to discover all modules, classes, and interfaces. It then generates one RST stub file per JSDoc HTML page, mirroring JSDoc's own page structure:

```
source/api/
  auth/
    index.rst            <- module-auth.html
    AuthProvider.rst     <- module-auth-AuthProvider.html
    Authenticator.rst    <- module-auth-Authenticator.html
  policies/
    loadBalancing/
      index.rst          <- module-policies_loadBalancing.html
      AllowListPolicy.rst
      ...
  Client.rst             <- Client.html (global class)
  modules.rst            <- hub page with toctree
  classes.rst             <- hub page for global classes
  ...
```

Each RST stub is minimal — just a title and a `.. jsdoc-include::` directive:

```rst
AuthProvider
============

.. jsdoc-include:: module-auth-AuthProvider.html
```

**Change detection:** The script stores a checksum of the JSDoc nav. On subsequent runs, it skips regeneration if nothing changed. Use `--force` to regenerate everything:

```bash
python _utils/generate_api_pages.py --force
```

**Stale file cleanup:** When a class or module is removed from JSDoc, the script automatically deletes the corresponding RST file.

### Sphinx extension (`_extensions/jsdoc_content.py`)

The `jsdoc_content` extension provides the `.. jsdoc-include::` directive. At build time it:

1. Reads the referenced JSDoc HTML file from `public/docs/`
2. Extracts the `<div id="main">` content
3. Strips the page title (the RST title replaces it)
4. Adjusts heading levels to fit under the RST page hierarchy
5. Rewrites cross-page links from JSDoc filenames to Sphinx page URLs
6. Applies cleanup (removes source links, adds theme-compatible CSS classes)

### Custom styles (`source/_static/custom.css`)

Minor CSS overrides for JSDoc content embedded in the Sphinx theme (muted type annotations, indented parameter tables, etc.).

## Adding new modules or classes

When you add a new module, class, or interface to the JavaScript source:

1. Run `make dirhtml` (or `make preview`)

That's it. The build chain regenerates JSDoc, detects the new pages in the nav, creates the RST stubs, and builds the site.

## Configuration

- **`conf.py`** — `jsdoc_html_dir` points to the JSDoc output directory (default: `../../public/docs`)
- **`Makefile`** — `jsdoc` target runs `npm run js-doc`; `api-pages` target runs the RST generator
