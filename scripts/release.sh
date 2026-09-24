#!/bin/sh
# Release a new version: sets manifest.json's version, commits it, and pushes
# a matching tag. The tag push makes .github/workflows/release.yml build the
# zip and publish the GitHub release.
#
#   scripts/release.sh 0.5.1            # checks, then asks before pushing
#   scripts/release.sh 0.5.1 --dry-run  # checks only; changes nothing
#   scripts/release.sh 0.5.1 --yes      # no prompt
set -eu
cd "$(dirname "$0")/.."

die() { echo "release: $*" >&2; exit 1; }
# Prints the higher of two x.y.z versions.
max_version() { printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1; }
manifest_version() { python3 -c 'import json; print(json.load(open("manifest.json"))["version"])'; }

version="" yes="" dry=""
for arg in "$@"; do
  case "$arg" in
    --yes) yes=1 ;;
    --dry-run) dry=1 ;;
    -*) die "unknown option $arg" ;;
    *) [ -z "$version" ] || die "give one version only"; version=$arg ;;
  esac
done
[ -n "$version" ] || die "usage: scripts/release.sh <version> [--dry-run | --yes]"
echo "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "version must look like 1.2.3 (got '$version')"
tag="v$version"

# Release exactly what's on GitHub: main, nothing uncommitted, in sync.
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on main"
[ -z "$(git status --porcelain)" ] || die "there are uncommitted changes; commit or stash them first"
git fetch --quiet --tags origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main isn't in sync with origin/main; pull or push first"

# The tag must be new, locally and on GitHub, and newer than every release so far.
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"
[ -z "$(git ls-remote --tags origin "refs/tags/$tag")" ] || die "tag $tag already exists on GitHub"
latest=$(git tag -l 'v[0-9]*' | sed 's/^v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1 || true)
if [ -n "$latest" ] && [ "$(max_version "$latest" "$version")" != "$version" ]; then
  die "$version isn't newer than the latest release ($latest)"
fi
current=$(manifest_version)
[ "$(max_version "$current" "$version")" = "$version" ] || die "$version is lower than manifest.json's version ($current)"

repo_url=$(git remote get-url origin | sed -e 's#^git@github.com:#https://github.com/#' -e 's#\.git$##')
echo "Release $version"
[ "$current" = "$version" ] && echo "  manifest.json already says $version" || echo "  manifest.json: $current -> $version (committed as \"Release $version\")"
echo "  push main and tag $tag to $repo_url"
case "$tag" in v0.*) kind="pre-release" ;; *) kind="release" ;; esac # matches release.yml
echo "  GitHub then builds the zip and publishes it as a $kind"

if [ -n "$dry" ]; then echo "Dry run: all checks passed; nothing changed."; exit 0; fi
if [ -z "$yes" ]; then
  [ -t 0 ] || die "not running in a terminal; pass --yes to release without the prompt"
  printf 'Go ahead? [y/N] '
  read -r answer
  [ "$answer" = y ] || [ "$answer" = Y ] || die "cancelled; nothing changed"
fi

if [ "$current" != "$version" ]; then
  python3 - "$version" <<'PY'
import re, sys
text = open("manifest.json").read()
text, n = re.subn(r'("version"\s*:\s*")[^"]*(")', r"\g<1>" + sys.argv[1] + r"\g<2>", text, count=1)
if n != 1:
    sys.exit("release: couldn't find the version in manifest.json")
open("manifest.json", "w").write(text)
PY
  git commit --quiet -m "Release $version" manifest.json
fi
./scripts/build.sh >/dev/null # same check the workflow runs: every manifest file is committed
git tag -a "$tag" -m "Release $version"
git push --quiet origin main
git push --quiet origin "$tag"
echo "Pushed $tag. Watch the build at $repo_url/actions; the release appears at $repo_url/releases"
