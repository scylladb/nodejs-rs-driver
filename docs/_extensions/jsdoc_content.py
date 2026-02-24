"""
Sphinx extension to embed JSDoc-generated HTML content into Sphinx pages.

Provides a ``.. jsdoc-include::`` directive that reads JSDoc HTML files,
extracts the ``<div id="main">`` content, and embeds it as raw HTML.
Sphinx's own theme CSS styles the output.

File discovery is driven by the ``<nav>`` in JSDoc's ``index.html``, so
the extension automatically adapts when modules, classes, or interfaces
are added or removed — no hard-coded file lists needed.

Usage in RST::

    .. jsdoc-include:: module-auth-AuthProvider.html

This will embed the content of the ``module-auth-AuthProvider.html`` JSDoc
file into the current page.

Supported category names:

* An explicit filename like ``module-auth-AuthProvider.html``.
* A module name like ``auth``, ``types``, ``errors``, ``policies/loadBalancing``
  -- includes only the module overview page.
* ``modules`` -- all module overview pages.
* ``classes`` -- all class pages (global and module-scoped).
* ``interfaces`` -- all interface pages.
* ``events`` -- events section from Client.html.
* ``globals`` -- the ``global.html`` page.

Configuration in ``conf.py``::

    jsdoc_html_dir = "../../public/docs"   # relative to conf.py
"""

import posixpath
import re
from pathlib import Path

from docutils import nodes
from docutils.parsers.rst import Directive
from sphinx.util import logging

__version__ = "2.0.0"
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# File discovery (driven by JSDoc index.html nav)
# ---------------------------------------------------------------------------

# Module-level cache so the nav is parsed at most once per jsdoc_dir.
_nav_cache = {}

# JSDoc uses "Global" (singular) as the nav heading; directives use "globals".
_CATEGORY_ALIASES = {"globals": "global"}


def _resolve_jsdoc_dir(config, env):
    """Return the resolved Path to the JSDoc HTML output directory."""
    rel = config.jsdoc_html_dir or "../../public/docs"
    return Path(env.app.confdir, rel).resolve()


def _parse_nav_index(jsdoc_dir):
    """Parse the ``<nav>`` in *index.html* and return a category-to-filenames mapping.

    Returns a dict like::

        {
            "modules":    ["module-auth.html", ...],
            "classes":    ["Client.html", "module-auth-AuthProvider.html", ...],
            "interfaces": ["module-mapping-TableMappings.html", ...],
            "events":     ["Client.html"],
            "global":     ["global.html"],
        }

    Anchors (``#…``) are stripped and filenames are deduplicated while
    preserving the order that JSDoc emits.
    """
    index_path = jsdoc_dir / "index.html"
    if not index_path.is_file():
        logger.warning("jsdoc-include: index.html not found in %s", jsdoc_dir)
        return {}

    html_text = index_path.read_text(encoding="utf-8")

    nav_match = re.search(r"<nav>(.*?)</nav>", html_text, re.DOTALL)
    if not nav_match:
        logger.warning("jsdoc-include: no <nav> found in index.html")
        return {}

    nav_html = nav_match.group(1)

    # Each section looks like: <h3>SectionName</h3><ul>…links…</ul>
    sections = re.findall(
        r"<h3>([^<]+)</h3>\s*<ul>(.*?)</ul>", nav_html, re.DOTALL
    )

    result = {}
    for section_name, ul_content in sections:
        key = section_name.strip().lower()
        hrefs = re.findall(r'href="([^"]+)"', ul_content)
        # Strip anchors and deduplicate while preserving order
        filenames = []
        seen = set()
        for href in hrefs:
            fname = href.split("#")[0]
            if fname and fname not in seen:
                filenames.append(fname)
                seen.add(fname)
        result[key] = filenames

    return result


def _get_nav(jsdoc_dir):
    """Return the parsed nav index, caching per directory."""
    key = str(jsdoc_dir)
    if key not in _nav_cache:
        _nav_cache[key] = _parse_nav_index(jsdoc_dir)
    return _nav_cache[key]


def _resolve_filenames(category, jsdoc_dir):
    """Turn a category name into a list of HTML filenames.

    *category* can be:
    - An explicit filename (``Client.html``, ``module-auth-AuthProvider.html``)
    - A JSDoc category (``modules``, ``classes``, ``interfaces``, ``events``, ``globals``)
    - A module name (``auth``, ``policies/loadBalancing``) -- returns only the module overview page

    File lists are derived from the JSDoc-generated ``index.html`` nav.
    """
    nav = _get_nav(jsdoc_dir)

    # Explicit filename
    if category.endswith(".html"):
        return [category] if (jsdoc_dir / category).is_file() else []

    # Built-in categories read straight from the nav
    nav_key = _CATEGORY_ALIASES.get(category, category)
    if nav_key in nav:
        return nav[nav_key]

    # Check if a file with this exact name exists (e.g. "Client" -> "Client.html")
    direct = f"{category}.html"
    if (jsdoc_dir / direct).is_file():
        return [direct]

    # Module name lookup — return only the module overview page
    mod_prefix = "module-" + category.replace("/", "_")
    mod_file = mod_prefix + ".html"
    if (jsdoc_dir / mod_file).is_file():
        return [mod_file]

    return []


# ---------------------------------------------------------------------------
# JSDoc filename → Sphinx docname mapping (for cross-page link rewriting)
# ---------------------------------------------------------------------------

_sphinx_map_cache = {}


def _build_jsdoc_sphinx_map(jsdoc_dir):
    """Build a mapping from JSDoc HTML filename to Sphinx docname.

    The mapping is based on the nav structure and mirrors the RST page layout::

        module-auth.html                → api/auth/index
        module-auth-AuthProvider.html   → api/auth/AuthProvider
        Client.html                     → api/Client
        global.html                     → api/globals

    Returns a dict of {filename: docname}.
    """
    key = str(jsdoc_dir)
    if key in _sphinx_map_cache:
        return _sphinx_map_cache[key]

    nav = _get_nav(jsdoc_dir)
    mapping = {}

    # Build module ID → path mapping
    # e.g. "auth" → "auth", "policies_loadBalancing" → "policies/loadBalancing"
    mod_ids = {}
    for fname in nav.get("modules", []):
        stem = fname.rsplit(".", 1)[0]  # "module-auth"
        mod_id = stem[len("module-"):]  # "auth" or "policies_loadBalancing"
        mod_path = mod_id.replace("_", "/")
        mod_ids[mod_id] = mod_path
        mapping[fname] = f"api/{mod_path}/index"

    def _safe_page_name(name):
        """Avoid case-insensitive collision with index on macOS/Windows."""
        if name.lower() == "index":
            return name + "-class"
        return name

    # Classes and interfaces
    for cat in ("classes", "interfaces"):
        for fname in nav.get(cat, []):
            if fname in mapping:
                continue  # Already mapped as a module page

            stem = fname.rsplit(".", 1)[0]

            if not stem.startswith("module-"):
                # Global class (e.g. Client, AddressResolver)
                mapping[fname] = f"api/{stem}"
                continue

            # Module class/interface: find longest matching module prefix
            rest = stem[len("module-"):]
            best_mod_id = None
            for mid in mod_ids:
                if rest.startswith(mid + "-"):
                    if best_mod_id is None or len(mid) > len(best_mod_id):
                        best_mod_id = mid

            if best_mod_id:
                class_name = rest[len(best_mod_id) + 1:]
                mod_path = mod_ids[best_mod_id]
                page_name = _safe_page_name(class_name)
                mapping[fname] = f"api/{mod_path}/{page_name}"
            else:
                # Fallback: treat as global
                mapping[fname] = f"api/{stem}"

    # Global page
    mapping["global.html"] = "api/globals"

    _sphinx_map_cache[key] = mapping
    return mapping


# ---------------------------------------------------------------------------
# HTML extraction & transformation
# ---------------------------------------------------------------------------

def _shift_headings(html, shift):
    """Shift all HTML heading levels by *shift*, clamping to h1–h6."""
    def _replace(m):
        slash = m.group(1)
        level = max(1, min(int(m.group(2)) + shift, 6))
        return f"<{slash}h{level}"
    return re.sub(r"<(/?)h([1-6])", _replace, html)


def _rewrite_links(html, current_docname, jsdoc_dir, use_dirhtml=True):
    """Rewrite JSDoc hrefs to cross-page Sphinx URLs.

    Links to JSDoc HTML files (e.g. ``module-auth-AuthProvider.html``)
    are rewritten to relative Sphinx page URLs based on the current
    page's location in the output.  When *use_dirhtml* is ``True``
    (the default), links use trailing-slash style (``AuthProvider/``);
    otherwise they use ``.html`` style (``AuthProvider.html``).
    """
    sphinx_map = _build_jsdoc_sphinx_map(jsdoc_dir)

    def _docname_base(docname):
        """URL base directory for a docname in dirhtml mode."""
        if docname.endswith("/index"):
            return docname[:-6]
        return docname

    if use_dirhtml:
        current_base = _docname_base(current_docname)
    else:
        # html builder: current page dir is the dirname of the docname
        current_base = posixpath.dirname(current_docname)

    def _replace(m):
        href = m.group(1)
        fname, _, fragment = href.partition("#")

        if fname not in sphinx_map:
            return m.group(0)

        target_docname = sphinx_map[fname]

        if use_dirhtml:
            target_base = _docname_base(target_docname)
            rel = posixpath.relpath(target_base, current_base)
            url = rel + "/"
        else:
            # html builder: docname maps directly to docname.html
            rel = posixpath.relpath(target_docname, current_base)
            url = rel + ".html"

        if fragment:
            url += f"#{fragment}"

        return f'href="{url}"'

    return re.sub(r'href="([^"]*\.html(?:#[^"]*)?)"', _replace, html)


def _convert_details_blocks(html, github_source_url=None):
    """Convert ``<dl class="details">`` entries to Sphinx admonitions.

    Transforms JSDoc Source and Deprecated entries from ``<dt>/<dd>``
    pairs inside ``<dl class="details">`` into theme-styled admonitions.
    """
    def _process_dl(m):
        dl_content = m.group(1)
        admonitions = []

        # --- Source → note admonition ---
        for sm in re.finditer(
            r'<dt class="tag-source">.*?</dd>', dl_content, re.DOTALL,
        ):
            block = sm.group(0)
            file_match = re.search(r'<a href="[^"]*">([^<]+)</a>', block)
            line_match = re.search(r'<a href="[^"]*#line(\d+)">', block)
            if not file_match:
                continue
            file_path = file_match.group(1).strip()
            link_text = file_path
            if line_match:
                link_text += f', line {line_match.group(1)}'
            if github_source_url:
                url = f"{github_source_url}/{file_path}"
                if line_match:
                    url += f"#L{line_match.group(1)}"
                admonitions.append(
                    f'<div class="admonition note">'
                    f'<p class="admonition-title">Source</p>'
                    f'<p><a href="{url}" target="_blank" '
                    f'rel="noopener">{link_text}</a></p></div>'
                )
            # Without github_source_url, source links are omitted.

        # --- Deprecated → warning admonition ---
        for dm in re.finditer(
            r'<dt class="important tag-deprecated">.*?</dd>',
            dl_content, re.DOTALL,
        ):
            block = dm.group(0)
            li_match = re.search(r'<li>(.*?)</li>', block, re.DOTALL)
            reason = li_match.group(1).strip() if li_match else ''
            admonitions.append(
                f'<div class="admonition warning">'
                f'<p class="admonition-title">Deprecated</p>'
                f'<p>{reason}</p></div>'
            )

        # Remove converted entries from dl
        cleaned = re.sub(
            r'<dt class="tag-source">.*?</dd>', '', dl_content,
            flags=re.DOTALL,
        )
        cleaned = re.sub(
            r'<dt class="important tag-deprecated">.*?</dd>', '', cleaned,
            flags=re.DOTALL,
        )

        result = ''
        if cleaned.strip():
            result += f'<dl class="details">{cleaned}</dl>'
        result += '\n'.join(admonitions)
        return result

    return re.sub(
        r'<dl class="details">(.*?)</dl>', _process_dl, html,
        flags=re.DOTALL,
    )


def _strip_noise(html, github_source_url=None):
    """Clean up JSDoc HTML noise."""
    html = _convert_details_blocks(html, github_source_url=github_source_url)
    # Add Sphinx table classes so JSDoc tables match theme styling.
    html = re.sub(
        r'<table class="params">',
        '<table class="params docutils align-default">',
        html,
    )
    html = re.sub(
        r'<table class="props">',
        '<table class="props docutils align-default">',
        html,
    )
    # Convert JSDoc prettyprint blocks to Sphinx highlight format
    # so the theme adds the copy button automatically.
    html = re.sub(
        r'<pre class="prettyprint"><code>(.*?)</code></pre>',
        r'<div class="highlight-javascript notranslate">'
        r'<div class="highlight"><pre>\1</pre></div></div>',
        html,
        flags=re.DOTALL,
    )
    return html


def _strip_wrapper_tags(html):
    """Strip JSDoc wrapper tags, keeping inner content.

    JSDoc wraps page content in ``<section><header>…</header><article>…
    </article></section>``.  Module pages with many members may repeat
    this pattern multiple times.  These wrapper tags must be removed
    before splitting the content at heading boundaries, otherwise the
    opening tags end up in one split part and the closing tags in
    another, producing broken HTML that cascades through the page layout.

    Also strips ``<div class="container-overview">`` wrappers so the
    Constructor heading inside them becomes a top-level split point.

    Only bare ``<section>`` / ``<article>`` tags (without attributes) are
    removed — Sphinx-generated ``<section id="…">`` nodes are preserved.
    """
    html = re.sub(r'<section>\s*', '', html)
    html = re.sub(r'\s*</section>', '', html)
    html = re.sub(r'<article>\s*', '', html)
    html = re.sub(r'\s*</article>', '', html)
    html = _strip_div_by_class(html, 'container-overview')

    # Mark the Constructor heading with subsection-title so
    # _split_at_subsections() creates a proper Sphinx section for it.
    html = re.sub(
        r'<h([23])>Constructor</h\1>',
        r'<h\1 class="subsection-title">Constructor</h\1>',
        html,
    )
    return html


def _strip_div_by_class(html, class_name):
    """Remove ``<div class="…">…</div>`` wrappers with *class_name*, keeping content."""
    open_tag = f'<div class="{class_name}">'
    while True:
        start = html.find(open_tag)
        if start == -1:
            break
        # Find matching </div> using depth counting
        depth = 1
        pos = start + len(open_tag)
        while pos < len(html) and depth > 0:
            if html[pos:].startswith('<div'):
                depth += 1
                pos += 4
            elif html[pos:].startswith('</div>'):
                depth -= 1
                if depth == 0:
                    inner = html[start + len(open_tag):pos]
                    html = html[:start] + inner + html[pos + 6:]
                    break
                pos += 6
            else:
                pos += 1
    return html


def _split_at_subsections(html):
    """Split body HTML at JSDoc ``subsection-title`` headings.

    These headings (Methods, Members, Classes, etc.) are always at the
    ``<article>`` level — never nested inside ``<div class="container-
    overview">`` — so splitting here produces balanced HTML fragments.

    Returns a list of parts::

        [
            {"type": "raw", "html": "…"},
            {"type": "section", "title": "Methods", "id": "methods",
             "level": 3, "html": "…"},
        ]
    """
    heading_re = re.compile(
        r'<h([23])\s+class="subsection-title"[^>]*>(.*?)</h\1>',
        re.DOTALL,
    )

    parts = []
    last_end = 0

    for m in heading_re.finditer(html):
        level = int(m.group(1))
        title_text = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        if not title_text:
            continue

        # Content before this heading
        pre = html[last_end:m.start()]
        if pre.strip():
            if parts and parts[-1]["type"] == "section":
                parts[-1]["html"] += pre
            else:
                parts.append({"type": "raw", "html": pre})

        slug = re.sub(r'[^a-z0-9]+', '-', title_text.lower()).strip('-')
        parts.append({
            "type": "section",
            "level": level,
            "title": title_text,
            "id": slug,
            "html": "",
        })
        last_end = m.end()

    # Remaining content after last heading
    remaining = html[last_end:]
    if remaining.strip():
        if parts and parts[-1]["type"] == "section":
            parts[-1]["html"] += remaining
        else:
            parts.append({"type": "raw", "html": remaining})

    return parts


def extract_main_content(html_text, filename=None, current_docname=None,
                         jsdoc_dir=None, github_source_url=None,
                         use_dirhtml=True):
    """Extract the ``<div id="main">…</div>`` from a JSDoc HTML page.

    Returns a dict with:

    * ``title``     – clean title text (e.g. ``auth``, ``AuthProvider``)
    * ``is_module`` – *True* when the page is a Module overview
    * ``body``      – body HTML with headings shifted and links rewritten

    Returns *None* when content cannot be extracted.
    """
    m = re.search(r'<div id="main">(.*?)</div>\s*<nav', html_text, re.DOTALL)
    if not m:
        m = re.search(r'<div id="main">(.*?)</div>\s*<br', html_text, re.DOTALL)
    if not m:
        return None

    content = m.group(1)

    # --- parse and strip page title -----------------------------------------
    title = ""
    is_module = False

    title_match = re.search(
        r'<h1 class="page-title">(.*?)</h1>', content, re.DOTALL,
    )
    if title_match:
        raw_title = title_match.group(1).strip()
        content = re.sub(
            r'\s*<h1 class="page-title">.*?</h1>\s*', '', content,
            flags=re.DOTALL,
        )
        if raw_title.startswith("Module:"):
            title = raw_title[len("Module:"):].strip()
            is_module = True
        elif raw_title.startswith("Class:"):
            title = raw_title[len("Class:"):].strip()
        elif raw_title.startswith("Interface:"):
            title = raw_title[len("Interface:"):].strip()
        else:
            title = raw_title

    content = _strip_noise(content, github_source_url=github_source_url)

    # Module pages: h1(stripped) → h3("Classes") should become h2 → shift -1
    # Class/interface/global pages: h2–h5 hierarchy is already correct → shift 0
    shift = -1 if is_module else 0
    if shift:
        content = _shift_headings(content, shift)
    if current_docname and jsdoc_dir:
        content = _rewrite_links(content, current_docname, jsdoc_dir,
                                use_dirhtml=use_dirhtml)

    return {
        "title": title,
        "is_module": is_module,
        "body": content.strip(),
    }


def extract_events_content(html_text, current_docname=None, jsdoc_dir=None,
                           github_source_url=None, use_dirhtml=True):
    """Extract the Events section from a JSDoc HTML page (e.g. Client.html)."""
    m = re.search(
        r'<h3 class="subsection-title">Events</h3>(.*?)(?=<h3 class="subsection-title"|</div>\s*<nav)',
        html_text,
        re.DOTALL,
    )
    if not m:
        return None

    content = m.group(1)

    # Strip orphaned closing tags from the end of the extracted section.
    # The regex captures </article> and </section> that belong to the
    # JSDoc page wrapper, not the events content.
    content = re.sub(r'(</article>\s*|</section>\s*)+$', '', content.rstrip())

    content = _strip_noise(content, github_source_url=github_source_url)

    # Event names are h4 in JSDoc, should be h2 under the RST h1 title
    content = _shift_headings(content, -2)

    if current_docname and jsdoc_dir:
        content = _rewrite_links(content, current_docname, jsdoc_dir,
                                use_dirhtml=use_dirhtml)

    return content.strip()


# ---------------------------------------------------------------------------
# Directive
# ---------------------------------------------------------------------------

class JsDocIncludeDirective(Directive):
    """Embed JSDoc HTML content for a module, class, or category.

    Each RST page embeds the content of a single JSDoc HTML file.  The RST
    page title serves as the heading; the directive only emits the body.
    """
    has_content = True
    required_arguments = 0
    optional_arguments = 100
    final_argument_whitespace = True

    def run(self):
        env = self.state.document.settings.env
        config = env.config
        jsdoc_dir = _resolve_jsdoc_dir(config, env)
        current_docname = env.docname

        # Detect builder to generate correct link style
        use_dirhtml = getattr(env.app.builder, "name", "dirhtml") == "dirhtml"

        # Build GitHub source URL from config
        github_source_url = None
        repo = getattr(config, "jsdoc_github_repository", "")
        source_path = getattr(config, "jsdoc_source_path", "lib")
        if repo:
            # Use SMV_CURRENT_VERSION (set by sphinx-multiversion) or
            # fall back to the configured default branch.
            import os
            branch = os.environ.get(
                "SMV_CURRENT_VERSION",
                getattr(config, "jsdoc_default_branch", "main"),
            )
            github_source_url = (
                f"https://github.com/{repo}/blob/{branch}/{source_path}"
            )

        # Collect categories from arguments and body
        categories = list(self.arguments)
        for line in self.content:
            stripped = line.strip()
            if stripped:
                categories.append(stripped)

        if not categories:
            logger.warning("jsdoc-include directive has no categories")
            return []

        result_nodes = []
        for cat in categories:
            filenames = _resolve_filenames(cat, jsdoc_dir)
            if not filenames:
                logger.warning("jsdoc-include: no files found for '%s'", cat)
                continue

            for fname in filenames:
                html_path = jsdoc_dir / fname
                if not html_path.is_file():
                    logger.warning("jsdoc-include: file not found: %s", fname)
                    continue

                html_text = html_path.read_text(encoding="utf-8")

                if cat == "events":
                    body = extract_events_content(
                        html_text,
                        current_docname=current_docname,
                        jsdoc_dir=jsdoc_dir,
                        github_source_url=github_source_url,
                        use_dirhtml=use_dirhtml,
                    )
                    if body is None:
                        logger.warning(
                            "jsdoc-include: could not extract content from %s",
                            fname,
                        )
                        continue
                    wrapped = f'<div class="jsdoc-content">{body}</div>\n'
                    result_nodes.append(
                        nodes.raw("", wrapped, format="html")
                    )
                    continue

                info = extract_main_content(
                    html_text,
                    filename=fname,
                    current_docname=current_docname,
                    jsdoc_dir=jsdoc_dir,
                    github_source_url=github_source_url,
                    use_dirhtml=use_dirhtml,
                )
                if info is None:
                    logger.warning(
                        "jsdoc-include: could not extract content from %s",
                        fname,
                    )
                    continue

                # Strip JSDoc wrapper tags so the content can be
                # safely split at subsection headings.
                body = _strip_wrapper_tags(info["body"])
                parts = _split_at_subsections(body)

                for part in parts:
                    wrapped = (
                        f'<div class="jsdoc-content">'
                        f'{part["html"]}</div>\n'
                    )
                    if part["type"] == "section":
                        section = nodes.section()
                        section["ids"] = [part["id"]]
                        section += nodes.title(
                            part["title"], part["title"],
                        )
                        section += nodes.raw("", wrapped, format="html")
                        result_nodes.append(section)
                    else:
                        result_nodes.append(
                            nodes.raw("", wrapped, format="html")
                        )

        return result_nodes


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

def setup(app):
    app.add_config_value("jsdoc_html_dir", "../../public/docs", "env")
    app.add_config_value("jsdoc_github_repository", "", "env")
    app.add_config_value("jsdoc_source_path", "lib", "env")
    app.add_config_value("jsdoc_default_branch", "main", "env")
    app.add_directive("jsdoc-include", JsDocIncludeDirective)

    return {
        "version": __version__,
        "parallel_read_safe": True,
        "parallel_write_safe": True,
    }
