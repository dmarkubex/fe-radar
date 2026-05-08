#!/usr/bin/env bash

set -euo pipefail

FORCE=0

if [ "${1:-}" = "--force" ]; then
  FORCE=1
  shift
fi

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 [--force] /path/to/project" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$1"

SNAPSHOT_FILES=()

record_snapshot_file() {
  SNAPSHOT_FILES+=("$1")
}

sync_file() {
  src="$1"
  dst="$2"
  rel="$3"
  if [ ! -f "$src" ]; then
    echo "WARNING: source file missing, skipping: $src" >&2
    return
  fi
  mkdir -p "$(dirname "$dst")"

  if [ ! -e "$dst" ] || [ "$FORCE" -eq 1 ]; then
    cp "$src" "$dst"
    echo "synced $dst"
  elif cmp -s "$src" "$dst"; then
    echo "unchanged $dst"
  else
    echo "skipped $dst (local edits present; use --force to overwrite)"
  fi
  record_snapshot_file "$rel"
}

mkdir -p "$TARGET_DIR/.ai/shared" "$TARGET_DIR/.ai/roles" "$TARGET_DIR/.ai/scripts" "$TARGET_DIR/.ai/handoff"

# Sync kernel snapshot files only.
# Project state files (handoff.md, project-overrides.md, project-lessons.md) are
# created once at bootstrap and must never be overwritten by sync, even with --force.

sync_file "$ROOT_DIR/AI_index.md" "$TARGET_DIR/AI_index.md" "AI_index.md"

for shared_file in "$ROOT_DIR/.ai/shared/"*.md; do
  [ -e "$shared_file" ] || continue
  rel=".ai/shared/$(basename "$shared_file")"
  sync_file "$shared_file" "$TARGET_DIR/$rel" "$rel"
done

# Active roles only — skip deprecated
for role_file in "$ROOT_DIR/.ai/roles/"*.md; do
  [ -e "$role_file" ] || continue
  base="$(basename "$role_file")"
  case "$base" in
    opencode.md|openspec.md) continue ;;
  esac
  rel=".ai/roles/$base"
  sync_file "$role_file" "$TARGET_DIR/$rel" "$rel"
done

# Scripts from root scripts/ dir
for helper_script in "$ROOT_DIR/scripts/"*.sh; do
  [ -e "$helper_script" ] || continue
  rel=".ai/scripts/$(basename "$helper_script")"
  sync_file "$helper_script" "$TARGET_DIR/$rel" "$rel"
done

KERNEL_VERSION=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "no-git")
PREVIOUS_KERNEL_VERSION=$(sed -n 's/^- kernel_version: //p' "$TARGET_DIR/.ai/meta-manifest.md" 2>/dev/null | head -n 1)
[ -n "$PREVIOUS_KERNEL_VERSION" ] || PREVIOUS_KERNEL_VERSION="unknown"

cat > "$TARGET_DIR/.ai/meta-manifest.md" <<EOF
# Meta Manifest

- source: $ROOT_DIR
- previous_kernel_version: $PREVIOUS_KERNEL_VERSION
- kernel_version: $KERNEL_VERSION
- synced_at: $(date "+%Y-%m-%d %H:%M:%S %Z")
- mode: sync
- snapshot_policy: frozen
EOF

for snapshot_file in "${SNAPSHOT_FILES[@]}"; do
  printf -- "- snapshot_file: %s\n" "$snapshot_file" >> "$TARGET_DIR/.ai/meta-manifest.md"
done

echo "sync complete for $TARGET_DIR"
