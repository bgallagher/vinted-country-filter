#!/bin/sh
# Build the extension zip for the Chrome Web Store and GitHub releases:
#   dist/vinted-country-filter-<version>.zip
# Packs the git-tracked files in src/ at HEAD (so the zip matches a commit),
# with src/ as the zip's root. Fails if a file the manifest references isn't
# in it.
set -eu
cd "$(dirname "$0")/.."

version=$(python3 -c 'import json; print(json.load(open("src/manifest.json"))["version"])')
out="dist/vinted-country-filter-$version.zip"

files=$(git ls-tree -r --name-only HEAD:src)

python3 - "$files" <<'PY'
import json, sys
included = set(sys.argv[1].split())
m = json.load(open("src/manifest.json"))
refs = set(m.get("icons", {}).values()) | set(m.get("action", {}).get("default_icon", {}).values())
refs |= {m["action"]["default_popup"], m["options_ui"]["page"]}
for cs in m["content_scripts"]:
    refs |= set(cs.get("js", [])) | set(cs.get("css", []))
for war in m.get("web_accessible_resources", []):
    refs |= set(war.get("resources", []))
missing = sorted(refs - included)
if missing:
    sys.exit("build: manifest references files missing from the zip (not committed?): " + ", ".join(missing))
PY

mkdir -p dist
rm -f "$out"
git archive --format=zip -o "$out" HEAD:src
echo "$out"
