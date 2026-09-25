#!/usr/bin/env python3

"""Validate and compare every source of the driver release version."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DRIVER_PACKAGE = "scylladb-javascript-driver"
SEMVER = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+$")


class VersionError(RuntimeError):
    """Raised when a release version source is absent or invalid."""


def read_file(path: str, ref: str | None = None) -> bytes:
    if ref is None:
        try:
            return (ROOT / path).read_bytes()
        except OSError as error:
            raise VersionError(f"Could not read {path}: {error}") from error

    result = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        cwd=ROOT,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        detail = result.stderr.decode(errors="replace").strip()
        raise VersionError(f"Could not read {path} at {ref}: {detail}")
    return result.stdout


def read_json(path: str, ref: str | None = None) -> Any:
    try:
        return json.loads(read_file(path, ref))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        location = f" at {ref}" if ref else ""
        raise VersionError(f"Could not parse {path}{location}: {error}") from error


def read_toml(path: str, ref: str | None = None) -> dict[str, Any]:
    try:
        return tomllib.loads(read_file(path, ref).decode())
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as error:
        location = f" at {ref}" if ref else ""
        raise VersionError(f"Could not parse {path}{location}: {error}") from error


def nested_value(document: Any, path: str, *keys: str) -> str:
    value = document
    try:
        for key in keys:
            value = value[key]
    except (KeyError, TypeError) as error:
        raise VersionError(f"{path} does not contain {'.'.join(keys)}") from error

    if not isinstance(value, str) or not value:
        raise VersionError(f"{path} has an invalid {'.'.join(keys)} value")
    return value


def release_versions(ref: str | None = None) -> dict[str, str]:
    package_json = read_json("package.json", ref)
    package_lock = read_json("package-lock.json", ref)
    cargo_toml = read_toml("Cargo.toml", ref)
    cargo_lock = read_toml("Cargo.lock", ref)
    examples_lock = read_json("examples/package-lock.json", ref)

    cargo_packages = [
        package
        for package in cargo_lock.get("package", [])
        if package.get("name") == DRIVER_PACKAGE
    ]
    if len(cargo_packages) != 1:
        raise VersionError(
            "Cargo.lock must contain exactly one "
            f"{DRIVER_PACKAGE!r} package, found {len(cargo_packages)}"
        )

    docs_target = read_file("docs/version", ref).decode().strip()
    if not docs_target.startswith("v"):
        raise VersionError("docs/version must contain a version with a leading 'v'")

    return {
        "package.json": nested_value(package_json, "package.json", "version"),
        "package-lock.json": nested_value(
            package_lock, "package-lock.json", "version"
        ),
        'package-lock.json packages[""]': nested_value(
            package_lock, "package-lock.json", "packages", "", "version"
        ),
        "Cargo.toml": nested_value(cargo_toml, "Cargo.toml", "package", "version"),
        "Cargo.lock": nested_value(cargo_packages[0], "Cargo.lock", "version"),
        'examples/package-lock.json packages[".."]': nested_value(
            examples_lock,
            "examples/package-lock.json",
            "packages",
            "..",
            "version",
        ),
        "docs/version": docs_target.removeprefix("v"),
    }


def primary_versions(ref: str) -> dict[str, str]:
    package_json = read_json("package.json", ref)
    cargo_toml = read_toml("Cargo.toml", ref)
    package_version = nested_value(package_json, "package.json", "version")

    try:
        docs_target = read_file("docs/version", ref).decode().strip()
    except VersionError:
        # When introducing docs/version, treat the base package version as the
        # prior docs target. Adding the source itself is not a release bump.
        docs_target = package_version
    else:
        docs_target = docs_target.removeprefix("v")

    return {
        "package.json": package_version,
        "Cargo.toml": nested_value(cargo_toml, "Cargo.toml", "package", "version"),
        "docs/version": docs_target,
    }


def write_output(name: str, value: str) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with open(output_path, "a", encoding="utf-8") as output:
            output.write(f"{name}={value}\n")


def version_tuple(version: str, label: str) -> tuple[int, int, int]:
    if not SEMVER.fullmatch(version):
        raise VersionError(f"{label} {version!r} must use the X.Y.Z format")
    return tuple(int(component) for component in version.split("."))


def require_version_order(
    version: str, previous: str, previous_label: str, policy: str = "newer"
) -> None:
    candidate = version_tuple(version, "Release version")
    published = version_tuple(previous, f"{previous_label} version")
    if policy == "newer":
        valid = candidate > published
        requirement = "newer than"
    elif policy == "not-older":
        valid = candidate >= published
        requirement = "at least"
    elif policy == "current":
        valid = candidate == published
        requirement = "equal to"
    else:
        raise VersionError(f"Unknown published version policy: {policy}")

    if not valid:
        raise VersionError(
            f"Release version {version} must be {requirement} "
            f"{previous_label} version {previous}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-ref",
        help="compare the package, Cargo, and docs target versions with this git ref",
    )
    parser.add_argument(
        "--published-version",
        action="append",
        default=[],
        help="published version to compare with the release (repeatable)",
    )
    parser.add_argument(
        "--published-version-policy",
        choices=("newer", "not-older", "current"),
        default="newer",
        help="required relationship to every --published-version",
    )
    args = parser.parse_args()

    try:
        versions = release_versions()
        unique_versions = set(versions.values())
        if len(unique_versions) != 1:
            details = "\n".join(
                f"  {source}: {version}" for source, version in versions.items()
            )
            raise VersionError(f"Release versions disagree:\n{details}")

        version = next(iter(unique_versions))
        version_tuple(version, "Release version")

        changed = True
        if args.base_ref:
            base = primary_versions(args.base_ref)
            current = {
                "package.json": versions["package.json"],
                "Cargo.toml": versions["Cargo.toml"],
                "docs/version": versions["docs/version"],
            }
            changes = [
                source for source in current if current[source] != base[source]
            ]
            changed = bool(changes)
            if changes:
                for source in changes:
                    require_version_order(
                        version,
                        base[source],
                        f"{source} at {args.base_ref}",
                    )
                print("Release version changed in: " + ", ".join(changes))
            else:
                print("No release version change detected.")

        for published_version in args.published_version:
            require_version_order(
                version,
                published_version,
                "published release",
                args.published_version_policy,
            )

        tag = f"v{version}"
        print(f"Validated release version {version} ({tag}).")
        write_output("version", version)
        write_output("tag", tag)
        write_output("changed", str(changed).lower())
        return 0
    except VersionError as error:
        print(f"::error::{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
