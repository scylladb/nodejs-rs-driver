#!/usr/bin/env bash

set -euo pipefail

tag=${1:?Usage: check-release-tag.sh TAG EXPECTED_SHA}
expected_sha=${2:?Usage: check-release-tag.sh TAG EXPECTED_SHA}
signing_fingerprint=71A6D22711CDB7C2446D21CFBF4BF97A8D4DF1AA

resolve_remote_tag() {
  local direct_sha=
  local peeled_sha=
  local remote_refs
  local sha
  local ref

  if ! remote_refs=$(git ls-remote \
    origin \
    "refs/tags/$tag" \
    "refs/tags/$tag^{}"); then
    echo "::error::Could not check the remote release tag." >&2
    exit 1
  fi

  while read -r sha ref; do
    case "$ref" in
      "refs/tags/$tag") direct_sha=$sha ;;
      "refs/tags/$tag^{}") peeled_sha=$sha ;;
    esac
  done <<< "$remote_refs"

  printf '%s' "${peeled_sha:-$direct_sha}"
}

require_expected_sha() {
  local remote_sha=$1

  if [[ "$remote_sha" != "$expected_sha" ]]; then
    echo "::error::Remote tag $tag points to ${remote_sha:-nothing}, not $expected_sha."
    exit 1
  fi
  echo "Remote tag $tag points to the release commit."
}

remote_sha=$(resolve_remote_tag)
if [[ -z "$remote_sha" ]]; then
  echo "::error::Remote tag $tag does not exist. Sign and push it before publishing."
  exit 1
fi

require_expected_sha "$remote_sha"

# Verify the remote tag object, not a possibly stale local tag.
git fetch --no-tags origin "refs/tags/$tag"
tag_object=$(git rev-parse FETCH_HEAD)
if [[ "$(git cat-file -t "$tag_object")" != tag ]] ||
   [[ "$(git rev-parse "$tag_object^{commit}")" != "$expected_sha" ]]; then
  echo "::error::Remote tag $tag is not an annotated tag for $expected_sha."
  exit 1
fi
signed_tag=$(git cat-file tag "$tag_object" | sed -n '/^$/q; s/^tag //p')
if [[ "$signed_tag" != "$tag" ]]; then
  echo "::error::Remote tag $tag contains a signature for ${signed_tag:-an unnamed tag}."
  exit 1
fi

export GNUPGHOME
GNUPGHOME=$(mktemp -d)
trap 'rm -rf "$GNUPGHOME"' EXIT
gpg --batch --import "$(dirname "$0")/release-signing.asc"
if ! verification=$(git -c gpg.program=gpg verify-tag --raw "$tag_object" 2>&1); then
  echo "::error::Remote tag $tag has an invalid GPG signature."
  echo "$verification" >&2
  exit 1
fi
if ! grep -q "^\[GNUPG:\] VALIDSIG $signing_fingerprint " <<< "$verification"; then
  echo "::error::Remote tag $tag was not signed by $signing_fingerprint."
  exit 1
fi
echo "Remote tag $tag has a valid signature from $signing_fingerprint."
