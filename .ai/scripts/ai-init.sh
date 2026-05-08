#!/usr/bin/env bash
# ai-init: 在当前目录初始化 AI coding kernel
# 用法: ai-init

set -euo pipefail

KERNEL_HOME="${AI_KERNEL_HOME:-$HOME/Documents/AI_coding_format}"

if [ ! -f "$KERNEL_HOME/scripts/ensure-project.sh" ]; then
  echo "ERROR: kernel not found at $KERNEL_HOME" >&2
  echo "Set AI_KERNEL_HOME or ensure ~/Documents/AI_coding_format exists." >&2
  exit 1
fi

exec "$KERNEL_HOME/scripts/ensure-project.sh" "$(pwd)"
