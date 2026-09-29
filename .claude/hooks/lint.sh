#!/bin/sh
# Claude Code PostToolUse hook (Edit|Write): lints the file Claude just edited.
# Exit 2 sends the lint output back to Claude so it fixes it in the same turn.
cd "$CLAUDE_PROJECT_DIR" || exit 0
f=$(jq -r '.tool_input.file_path // empty')
[ -f "$f" ] || exit 0

case "$f" in
  */node_modules/* | */dist/*) exit 0 ;;
  *.js | *.mjs) bin=node_modules/.bin/eslint; args="--no-warn-ignored" ;;
  *.css) bin=node_modules/.bin/stylelint; args="--allow-empty-input" ;;
  *) exit 0 ;;
esac
# Linters not installed yet (`npm install`): stay quiet rather than block edits.
[ -x "$bin" ] || exit 0

if ! out=$("$bin" $args "$f" 2>&1); then
  printf '%s\n' "$out" >&2
  exit 2
fi
