#!/bin/sh
# Claude Code Stop hook: when Claude finishes a turn in which the code or
# tests changed, run the test suite. A failure is sent back (exit 2) so
# Claude keeps working and fixes it in the same turn.
#
# .claude/.test-state remembers "<fingerprint> pass|fail" for the last run,
# so turns that change nothing cost nothing, and a failure Claude can't fix
# blocks once, not on every later turn.
cd "$CLAUDE_PROJECT_DIR" || exit 0
[ -d node_modules/jsdom ] || exit 0 # not installed yet (`npm install`)

state=.claude/.test-state
hash=$(git ls-files -z -co --exclude-standard -- '*.js' '*.mjs' '*.css' '*.html' '*.json' 'scripts/*' |
  xargs -0 shasum 2>/dev/null | shasum | cut -d' ' -f1)
last=$(cat "$state" 2>/dev/null)

[ "$last" = "$hash pass" ] && exit 0
if [ "$last" = "$hash fail" ]; then
  echo '{"systemMessage": "Tests are still failing (nothing changed since the last run). Run npm test for details."}'
  exit 0
fi

if out=$(npm test --silent 2>&1); then
  echo "$hash pass" > "$state"
  exit 0
fi
echo "$hash fail" > "$state"
{
  echo "npm test failed:"
  printf '%s\n' "$out" | sed -n '/failing tests:/,$p' | grep -vE '^[[:space:]]+at ' | head -80
} >&2
exit 2
