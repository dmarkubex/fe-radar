#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 \"lesson summary\"" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROJECT_DIR="$(cd "$AI_DIR/.." && pwd)"
MANIFEST_PATH="$AI_DIR/meta-manifest.md"

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "meta-manifest.md not found: $MANIFEST_PATH" >&2
  exit 1
fi

SOURCE_ROOT="$(sed -n 's/^- source: //p' "$MANIFEST_PATH" | head -n 1)"

if [ -z "$SOURCE_ROOT" ]; then
  echo "Could not resolve source path from $MANIFEST_PATH" >&2
  exit 1
fi

TARGET_FILE="$SOURCE_ROOT/.ai/shared/lessons.md"

if [ ! -f "$TARGET_FILE" ]; then
  echo "Target shared lessons file missing: $TARGET_FILE" >&2
  exit 1
fi

SUMMARY="$1"
DATE_STAMP="$(date "+%Y-%m-%d")"

cat >> "$TARGET_FILE" <<EOF

### $DATE_STAMP - Draft Promotion From $(basename "$PROJECT_DIR")

Summary: $SUMMARY

Source project: $PROJECT_DIR

Status: draft promotion appended by promote-lesson.sh. Normalize this into a
full lesson entry before relying on it as shared guidance.
EOF

echo "Appended lesson promotion draft to $TARGET_FILE"
