# -*- coding: utf-8 -*-
import os
import sys
from datetime import date
from sphinx_scylladb_theme.utils import multiversion_regex_builder

# Add _extensions directory to Python path for custom extensions
sys.path.insert(0, os.path.abspath("../_extensions"))

# -- General configuration ------------------------------------------

# Build documentation for the following tags and branches
TAGS = []
BRANCHES = ["main"]
LATEST_VERSION = "main"
UNSTABLE_VERSIONS = []
DEPRECATED_VERSIONS = []

# Add any Sphinx extension module names here, as strings.
extensions = [
    "sphinx.ext.todo",
    "sphinx.ext.githubpages",
    "sphinx.ext.extlinks",
    "sphinx_sitemap",
    "sphinx_scylladb_theme",
    "sphinx_multiversion",
    "myst_parser",
    "jsdoc_content",  # Embed JSDoc HTML content in Sphinx pages
]

# The suffix(es) of source filenames.
source_suffix = [".rst", ".md"]

# The master toctree document.
master_doc = "index"

# General information about the project.
project = "ScyllaDB Node.js Driver"
copyright = str(date.today().year) + " ScyllaDB"
author = "ScyllaDB Project Contributors"

# List of patterns, relative to source directory, that match files and
# directories to ignore when looking for source files.
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "**/_partials"]

# The name of the Pygments (syntax highlighting) style to use.
pygments_style = "sphinx"

# -- Options for jsdoc_content extension ----------------------------

# Path to JSDoc HTML output (relative to this conf.py)
jsdoc_html_dir = "../../public/docs"

# GitHub repository for source links (e.g. "Source: client.js, line 44")
jsdoc_github_repository = "scylladb/nodejs-rs-driver"
jsdoc_source_path = "lib"
jsdoc_default_branch = LATEST_VERSION

# Intro text and sections displayed on the API Reference landing page.
jsdoc_api_intro = "API documentation for the ScyllaDB Node.js Driver."
jsdoc_api_sections = [
    ("modules", "Browse modules."),
    ("classes", "Global classes provided by the driver."),
    ("interfaces", "Interface definitions."),
    ("events", "Events emitted by the ``Client`` instance."),
    ("globals", "Global functions and constants."),
]

# -- Options for myst parser ----------------------------------------
myst_enable_extensions = ["colon_fence"]

# -- Options for multiversion extension ----------------------------

smv_tag_whitelist = multiversion_regex_builder(TAGS)
smv_branch_whitelist = multiversion_regex_builder(BRANCHES)
smv_latest_version = LATEST_VERSION
smv_rename_latest_version = "stable"
smv_remote_whitelist = r"^origin$"
smv_released_pattern = r"^tags/.*$"
smv_outputdir_format = "{ref.name}"

# -- Options for sitemap extension ----------------------------------

sitemap_url_scheme = "/stable/{link}"

# -- Options for HTML output ----------------------------------------

# The theme to use for pages.
html_theme = "sphinx_scylladb_theme"

# Theme options are theme-specific and customize the look and feel of a theme
# further.  For a list of options available for the theme, see the
# documentation.
html_theme_options = {
    "conf_py_path": "docs/source/",
    "default_branch": "main",
    "hide_edit_this_page_button": "false",
    "hide_ai_chatbot": "false",
    "hide_feedback_buttons": "false",
    "github_issues_repository": "scylladb/nodejs-rs-driver",
    "github_repository": "scylladb/nodejs-rs-driver",
    "site_description": "Node.js Driver for ScyllaDB, built on top of Rust driver.",
    "versions_unstable": UNSTABLE_VERSIONS,
    "versions_deprecated": DEPRECATED_VERSIONS,
}

# Custom static files
html_static_path = ["_static"]
html_css_files = ["custom.css"]

# Last updated format
html_last_updated_fmt = "%d %b %Y"

# Custom sidebar templates, maps document names to template names.
html_sidebars = {"**": ["side-nav.html"]}

# Output file base name for HTML help builder.
htmlhelp_basename = "ScyllaDBNodeJSDriverDoc"

# URL which points to the root of the HTML documentation.
html_baseurl = "https://nodejs-rs-driver.docs.scylladb.com"

# Dictionary of values to pass into the template engine's context for all pages
html_context = {"html_baseurl": html_baseurl}

