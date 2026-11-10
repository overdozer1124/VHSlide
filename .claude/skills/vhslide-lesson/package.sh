#!/usr/bin/env bash
# Make vhslide-lesson.zip (for claude.ai upload or copying to ~/.claude/skills).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$PWD/vhslide-lesson.zip}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp -r "$here" "$tmp/vhslide-lesson"
rm -f "$tmp/vhslide-lesson/package.sh"
(cd "$tmp" && zip -qr -X "$out" vhslide-lesson)
echo "$out"
