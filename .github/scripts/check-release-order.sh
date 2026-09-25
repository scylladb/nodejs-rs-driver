#!/usr/bin/env bash

set -euo pipefail

policy=${1:?Usage: check-release-order.sh POLICY}
published_args=()
for package_name in \
  @scylladb/driver-linux-x64-gnu \
  @scylladb/driver-linux-arm64-gnu \
  @scylladb/driver
do
  if ! published_version=$(npm view "$package_name@latest" version --prefer-online); then
    echo "::error::Could not read the latest $package_name version from npm."
    exit 1
  fi
  published_args+=(--published-version "$published_version")
done

python3 .github/scripts/release-version.py \
  --published-version-policy "$policy" \
  "${published_args[@]}"
