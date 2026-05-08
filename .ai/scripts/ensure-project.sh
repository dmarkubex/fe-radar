#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/project" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$1"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

if [ "$(cd "$TARGET_DIR" && pwd)" = "$ROOT_DIR" ]; then
  echo "skip ensure: target is meta root"
  exit 0
fi

MANIFEST_PATH="$TARGET_DIR/.ai/meta-manifest.md"

if [ ! -e "$MANIFEST_PATH" ]; then
  "$SCRIPT_DIR/bootstrap-project.sh" "$TARGET_DIR"
else
  echo "project snapshot already initialized: $TARGET_DIR"

  # Integrity check: use the manifest's file list instead of hardcoded paths.
  # Does not auto-repair — run sync-meta.sh manually if needed.
  MISSING=0
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if [ ! -e "$TARGET_DIR/$f" ]; then
      echo "WARNING: missing snapshot file: $TARGET_DIR/$f" >&2
      MISSING=1
    fi
  done < <(sed -n 's/^- snapshot_file: //p' "$MANIFEST_PATH")
  if [ "$MISSING" -eq 1 ]; then
    echo "WARNING: snapshot is incomplete. Run sync-meta.sh to repair." >&2
  fi
fi
