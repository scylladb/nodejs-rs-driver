#!/usr/bin/env python3
"""Generate RST stub files for every JSDoc HTML page.

Creates a 1:1 mapping from JSDoc HTML files to Sphinx RST pages,
mirroring JSDoc's own page structure. Each RST file embeds the
corresponding JSDoc HTML content via the ``.. jsdoc-include::`` directive.

The script is idempotent: it only writes files whose content has changed
and removes stale RST files that no longer correspond to a JSDoc page.
A checksum of the JSDoc nav is stored so that the script can skip work
entirely when nothing has changed.

Usage::

    python docs/_utils/generate_api_pages.py          # run manually
    python docs/_utils/generate_api_pages.py --force   # regenerate everything
"""

import hashlib
import json
import re
import sys
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent.parent
JSDOC_DIR = DOCS_DIR.parent / "public" / "docs"
API_DIR = DOCS_DIR / "source" / "api"
CHECKSUM_FILE = API_DIR / ".jsdoc_nav_checksum"

# Hub pages that are always generated and should never be removed.
HUB_FILES = {"index.rst", "modules.rst", "classes.rst", "interfaces.rst",
             "events.rst", "globals.rst"}


# ---------------------------------------------------------------------------
# Parse JSDoc nav
# ---------------------------------------------------------------------------

def parse_nav(index_path):
    html = index_path.read_text(encoding="utf-8")
    nav_match = re.search(r"<nav>(.*?)</nav>", html, re.DOTALL)
    if not nav_match:
        raise RuntimeError("No <nav> found in index.html")

    nav_html = nav_match.group(1)
    sections = re.findall(
        r"<h3>([^<]+)</h3>\s*<ul>(.*?)</ul>", nav_html, re.DOTALL
    )

    result = {}
    for name, ul in sections:
        key = name.strip().lower()
        hrefs = re.findall(r'href="([^"]+)"', ul)
        filenames = []
        seen = set()
        for href in hrefs:
            fname = href.split("#")[0]
            if fname and fname not in seen:
                filenames.append(fname)
                seen.add(fname)
        result[key] = filenames
    return result


def nav_checksum(nav):
    """Return a stable hash of the nav structure."""
    serialized = json.dumps(nav, sort_keys=True).encode()
    return hashlib.sha256(serialized).hexdigest()


# ---------------------------------------------------------------------------
# Build module & class structure
# ---------------------------------------------------------------------------

def build_structure(nav):
    """Return (modules, module_classes, global_classes, interfaces).

    - modules: dict of mod_path -> jsdoc_filename
    - module_classes: dict of mod_path -> [(class_name, jsdoc_filename), ...]
    - global_classes: [(class_name, jsdoc_filename), ...]
    - interfaces: dict of mod_path -> [(iface_name, jsdoc_filename), ...]
    """
    modules = {}
    mod_ids = {}
    for fname in nav.get("modules", []):
        stem = fname.rsplit(".", 1)[0]
        mod_id = stem[len("module-"):]
        mod_path = mod_id.replace("_", "/")
        modules[mod_path] = fname
        mod_ids[mod_id] = mod_path

    def find_module(stem):
        rest = stem[len("module-"):]
        best_id = None
        for mid in mod_ids:
            if rest.startswith(mid + "-"):
                if best_id is None or len(mid) > len(best_id):
                    best_id = mid
        if best_id:
            class_name = rest[len(best_id) + 1:]
            return mod_ids[best_id], class_name
        return None, None

    module_classes = {mp: [] for mp in modules}
    global_classes = []
    for fname in nav.get("classes", []):
        stem = fname.rsplit(".", 1)[0]
        if stem.startswith("module-"):
            mid = stem[len("module-"):]
            if mid in mod_ids:
                continue
            mod_path, class_name = find_module(stem)
            if mod_path:
                module_classes[mod_path].append((class_name, fname))
            else:
                global_classes.append((stem, fname))
        else:
            global_classes.append((stem, fname))

    interfaces = {}
    for fname in nav.get("interfaces", []):
        stem = fname.rsplit(".", 1)[0]
        mod_path, iface_name = find_module(stem)
        if mod_path:
            interfaces.setdefault(mod_path, [])
            interfaces[mod_path].append((iface_name, fname))
        else:
            interfaces.setdefault("_global", [])
            interfaces["_global"].append((stem, fname))

    return modules, module_classes, global_classes, interfaces


# ---------------------------------------------------------------------------
# RST generation helpers
# ---------------------------------------------------------------------------

def rst_title(text, char="="):
    return f"{text}\n{char * len(text)}\n"


def safe_filename(name):
    """Avoid case-insensitive collision with index.rst on macOS/Windows."""
    if name.lower() == "index":
        return name + "-class"
    return name


def write_if_changed(path, content, written_paths):
    """Write *content* to *path* only if the file is missing or different."""
    written_paths.add(path)
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


# ---------------------------------------------------------------------------
# Generate pages
# ---------------------------------------------------------------------------

def generate(nav):
    """Generate all RST stubs. Returns (written, removed) counts."""
    modules, module_classes, global_classes, interfaces = build_structure(nav)

    written_paths = set()  # track every file we intend to keep
    changed = 0

    # --- Module index pages + class sub-pages ------------------------------
    top_modules = []
    sub_modules = {}

    for mod_path in sorted(modules):
        if "/" in mod_path:
            parent = mod_path.split("/")[0]
            sub_modules.setdefault(parent, [])
            sub_modules[parent].append(mod_path)
        else:
            top_modules.append(mod_path)

    for mod_path in sorted(modules):
        mod_fname = modules[mod_path]
        classes = module_classes.get(mod_path, [])
        ifaces = interfaces.get(mod_path, [])
        subs = sub_modules.get(mod_path, [])

        display = mod_path.split("/")[-1] if "/" in mod_path else mod_path

        parts = [rst_title(display)]
        parts.append(f".. jsdoc-include:: {mod_fname}\n")

        toctree_entries = []
        for sub_path in sorted(subs):
            sub_name = sub_path[len(mod_path) + 1:]
            toctree_entries.append(f"   {sub_name}/index")
        for cls_name, _ in classes:
            toctree_entries.append(f"   {safe_filename(cls_name)}")
        for iface_name, _ in ifaces:
            toctree_entries.append(f"   {safe_filename(iface_name)}")

        if toctree_entries:
            parts.append("")
            parts.append(".. toctree::")
            parts.append("   :hidden:")
            parts.append("")
            parts.extend(toctree_entries)
            parts.append("")

        if write_if_changed(API_DIR / mod_path / "index.rst",
                            "\n".join(parts), written_paths):
            changed += 1

        for cls_name, cls_fname in classes:
            fname = safe_filename(cls_name)
            content = f"{rst_title(cls_name)}\n.. jsdoc-include:: {cls_fname}\n"
            if write_if_changed(API_DIR / mod_path / f"{fname}.rst",
                                content, written_paths):
                changed += 1

        for iface_name, iface_fname in ifaces:
            fname = safe_filename(iface_name)
            content = f"{rst_title(iface_name)}\n.. jsdoc-include:: {iface_fname}\n"
            if write_if_changed(API_DIR / mod_path / f"{fname}.rst",
                                content, written_paths):
                changed += 1

    # --- Global class pages ------------------------------------------------
    for cls_name, cls_fname in global_classes:
        content = f"{rst_title(cls_name)}\n.. jsdoc-include:: {cls_fname}\n"
        if write_if_changed(API_DIR / f"{cls_name}.rst",
                            content, written_paths):
            changed += 1

    # --- Hub pages ---------------------------------------------------------
    if write_if_changed(API_DIR / "index.rst", "\n".join([
        rst_title("API Reference"),
        ".. toctree::",
        "   :hidden:",
        "",
        "   modules",
        "   classes",
        "   interfaces",
        "   events",
        "   globals",
        "",
    ]), written_paths):
        changed += 1

    mod_entries = [f"   {mp}/index" for mp in sorted(top_modules)]
    if write_if_changed(API_DIR / "modules.rst", "\n".join([
        rst_title("Modules"),
        ".. toctree::",
        "",
        *mod_entries,
        "",
    ]), written_paths):
        changed += 1

    cls_entries = [f"   {name}" for name, _ in sorted(global_classes)]
    if write_if_changed(API_DIR / "classes.rst", "\n".join([
        rst_title("Classes"),
        "Global classes provided by the driver.",
        "",
        ".. toctree::",
        "",
        *cls_entries,
        "",
    ]), written_paths):
        changed += 1

    iface_lines = [rst_title("Interfaces"), ""]
    for mod_path in sorted(interfaces):
        if mod_path == "_global":
            continue
        for iface_name, _ in interfaces[mod_path]:
            iface_lines.append(f"- :doc:`{mod_path}/{iface_name}`")
    iface_lines.append("")
    if write_if_changed(API_DIR / "interfaces.rst",
                        "\n".join(iface_lines), written_paths):
        changed += 1

    if write_if_changed(API_DIR / "events.rst", "\n".join([
        rst_title("Events"),
        "Events emitted by the ``Client`` instance.",
        "",
        ".. jsdoc-include:: events",
        "",
    ]), written_paths):
        changed += 1

    if write_if_changed(API_DIR / "globals.rst", "\n".join([
        rst_title("Global Functions and Constants"),
        ".. jsdoc-include:: globals",
        "",
    ]), written_paths):
        changed += 1

    # --- Remove stale files ------------------------------------------------
    removed = 0
    for rst_file in sorted(API_DIR.rglob("*.rst")):
        if rst_file not in written_paths:
            rst_file.unlink()
            removed += 1
            print(f"  removed {rst_file.relative_to(API_DIR)}")

    # Remove empty directories left behind
    for dirpath in sorted(API_DIR.rglob("*"), reverse=True):
        if dirpath.is_dir() and not any(dirpath.iterdir()):
            dirpath.rmdir()

    return changed, removed


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    force = "--force" in sys.argv

    index_path = JSDOC_DIR / "index.html"
    if not index_path.is_file():
        raise FileNotFoundError(f"JSDoc index not found: {index_path}")

    nav = parse_nav(index_path)
    checksum = nav_checksum(nav)

    # Skip if nothing changed (unless --force)
    if not force and CHECKSUM_FILE.is_file():
        if CHECKSUM_FILE.read_text().strip() == checksum:
            print("api-pages: JSDoc nav unchanged, nothing to do.")
            return

    print(f"api-pages: Generating RST stubs from JSDoc nav ...")
    print(f"  Modules: {len(nav.get('modules', []))}")
    print(f"  Classes: {len(nav.get('classes', []))}")
    print(f"  Interfaces: {len(nav.get('interfaces', []))}")

    changed, removed = generate(nav)

    # Save checksum
    CHECKSUM_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECKSUM_FILE.write_text(checksum + "\n")

    print(f"  {changed} file(s) written, {removed} stale file(s) removed.")


if __name__ == "__main__":
    main()
