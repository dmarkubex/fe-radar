#!/usr/bin/env bash
# ai-sync: 同步当前项目的 kernel snapshot 到最新版本
# 用法: ai-sync [--force]

set -euo pipefail

KERNEL_HOME="${AI_KERNEL_HOME:-$HOME/Documents/AI_coding_format}"

if [ ! -f "$KERNEL_HOME/scripts/sync-meta.sh" ]; then
  echo "ERROR: kernel not found at $KERNEL_HOME" >&2
  exit 1
fi

exec "$KERNEL_HOME/scripts/sync-meta.sh" "$@" "$(pwd)"
