#!/bin/sh
# Build the extension zip for the Chrome Web Store and GitHub releases:
#   dist/vinted-country-filter-<version>.zip
# Packs the git-tracked files at HEAD (so the zip matches a commit), minus
# repo-only files. Fails if a file the manifest references isn't in it.
set -eu
cd "$(dirname "$0")/.."

version=$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])')
out="dist/vinted-country-filter-$version.zip"

files=$(git ls-files | grep -vE '^(\.github/|store/|scripts/|\.gitignore$|README\.md$|CLAUDE\.md$|PRIVACY\.md$)')

python3 - "$files" <<'PY'
import json, sys
included = set(sys.argv[1].split())
m = json.load(open("manifest.json"))
refs = set(m.get("icons", {}).values()) | set(m.get("action", {}).get("default_icon", {}).values())
refs |= {m["action"]["default_popup"], m["options_ui"]["page"]}
for cs in m["content_scripts"]:
    refs |= set(cs.get("js", [])) | set(cs.get("css", []))
missing = sorted(refs - included)
if missing:
    sys.exit("build: manifest references files missing from the zip (not committed?): " + ", ".join(missing))
PY

mkdir -p dist
rm -f "$out"
# shellcheck disable=SC2086
git archive --format=zip -o "$out" HEAD $files
echo "$out"
