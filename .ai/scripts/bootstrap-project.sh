#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /path/to/project" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$1"

mkdir -p "$TARGET_DIR/.ai/shared" "$TARGET_DIR/.ai/roles" "$TARGET_DIR/.ai/scripts" "$TARGET_DIR/.ai/handoff"

SNAPSHOT_FILES=()

record_snapshot_file() {
  SNAPSHOT_FILES+=("$1")
}

copy_if_missing() {
  src="$1"
  dst="$2"
  rel="$3"
  if [ ! -f "$src" ]; then
    echo "WARNING: source file missing, skipping: $src" >&2
    return
  fi
  mkdir -p "$(dirname "$dst")"
  if [ ! -e "$dst" ]; then
    cp "$src" "$dst"
    echo "created $dst"
  else
    echo "kept $dst"
  fi
  record_snapshot_file "$rel"
}

write_if_missing() {
  dst="$1"
  rel="$2"
  content="$3"
  mkdir -p "$(dirname "$dst")"
  if [ ! -e "$dst" ]; then
    printf "%s\n" "$content" > "$dst"
    echo "created $dst"
  else
    echo "kept $dst"
  fi
  record_snapshot_file "$rel"
}

# --- Project state files (generated inline, no templates needed) ---

write_if_missing "$TARGET_DIR/handoff.md" "handoff.md" "$(cat <<'STATE_EOF'
# Handoff State

> This file is the project control token. It says who owns the next move and what must happen next.

---

## 1. Current Control

| Field | Value |
|-------|-------|
| Project | [project-name] |
| Mode | Lite / Standard / Full |
| Stage | Plan / Review Plan / Fix Plan / Execute / Review Code / Fix Code / Release / Retro |
| Owner | Orchestrator / Sub-Agent / Human |
| State | Planning / Delegating / Implementing / Reviewing / Blocked on Human / Human Testing |
| Active Agent | Claude Code / Codex / Antigravity |
| Last Updated | YYYY-MM-DD HH:MM CST |

## 2. Human Action Required

Use this section only when `Owner` is `Human`.

- Instruction: ...
- Acceptance Criteria: ...
- How To Hand Back Control: ...

## 3. Orchestrator Queue

### Current Objective

[one clear objective]

### Queue

- [ ] ...

## 4. Context & Risks

- Context:
  - ...
- Risks:
  - ...
- Pending Decisions:
  - ...
- Files Read This Session:
  - AI_index.md
  - handoff.md

## 5. Changes

### Planned
- ...

### Completed

- ...

## 6. Lessons This Session

### Promote To Shared Kernel

- ...

### Keep Project-Local

- ...

## 7. Next Handoff

- Next owner: ...
- Expected next stage: ...
STATE_EOF
)"

write_if_missing "$TARGET_DIR/.ai/project-overrides.md" ".ai/project-overrides.md" \
"# Project Overrides

Add only repository-specific rules here."

write_if_missing "$TARGET_DIR/.ai/project-lessons.md" ".ai/project-lessons.md" \
"# Project Lessons

Store repo-specific lessons here."

write_if_missing "$TARGET_DIR/.ai/task-handoff-template.md" ".ai/task-handoff-template.md" "$(cat <<'TMPL_EOF'
# Task Handoff Template

## Task

[task-id]

## Owner

[agent-name]

## Scope

[what this sub-agent owns]

## Status

Not started / In progress / Blocked / Done

## Changes

- ...

## Risks / Blockers

- ...
TMPL_EOF
)"

write_if_missing "$TARGET_DIR/.ai/.gitignore" ".ai/.gitignore" "$(cat <<'GI_EOF'
handoff/*
!handoff/.gitkeep
GI_EOF
)"

write_if_missing "$TARGET_DIR/.ai/handoff/.gitkeep" ".ai/handoff/.gitkeep" ""

# --- Kernel snapshot: AI_index.md (copy from root) ---

copy_if_missing "$ROOT_DIR/AI_index.md" "$TARGET_DIR/AI_index.md" "AI_index.md"

# --- Kernel snapshot: shared rules ---

for shared_file in "$ROOT_DIR/.ai/shared/"*.md; do
  [ -e "$shared_file" ] || continue
  rel=".ai/shared/$(basename "$shared_file")"
  copy_if_missing "$shared_file" "$TARGET_DIR/$rel" "$rel"
done

# --- Kernel snapshot: active roles only (skip deprecated) ---

for role_file in "$ROOT_DIR/.ai/roles/"*.md; do
  [ -e "$role_file" ] || continue
  base="$(basename "$role_file")"
  # Skip deprecated roles
  case "$base" in
    opencode.md|openspec.md) continue ;;
  esac
  rel=".ai/roles/$base"
  copy_if_missing "$role_file" "$TARGET_DIR/$rel" "$rel"
done

# --- Kernel snapshot: helper scripts ---

for helper_script in "$ROOT_DIR/scripts/"*.sh; do
  [ -e "$helper_script" ] || continue
  rel=".ai/scripts/$(basename "$helper_script")"
  copy_if_missing "$helper_script" "$TARGET_DIR/$rel" "$rel"
done

# --- Root .gitignore block ---

ensure_root_gitignore_block() {
  local gitignore="$TARGET_DIR/.gitignore"
  local marker_begin="# BEGIN AI_HARNESS"
  local marker_end="# END AI_HARNESS"
  if [ ! -f "$gitignore" ]; then
    printf "%s\n" "$marker_begin" "/handoff.md" "/.ai/handoff/*" "!/.ai/handoff/.gitkeep" "$marker_end" > "$gitignore"
    echo "created $gitignore"
    return
  fi
  if grep -qF "$marker_begin" "$gitignore" 2>/dev/null; then
    echo "kept $gitignore"
    return
  fi
  {
    printf "\n%s\n" "$marker_begin"
    printf "%s\n" "/handoff.md"
    printf "%s\n" "/.ai/handoff/*"
    printf "%s\n" "!/.ai/handoff/.gitkeep"
    printf "%s\n" "$marker_end"
  } >> "$gitignore"
  echo "updated $gitignore"
}

ensure_root_gitignore_block

# --- CLAUDE.md with kernel rules ---

ensure_claude_md() {
  local claude_md="$TARGET_DIR/CLAUDE.md"
  local marker_begin="# BEGIN AI_KERNEL"

  local kernel_block
  kernel_block=$(cat <<'KERNEL_EOF'
# BEGIN AI_KERNEL

## AI Workflow Kernel

This project uses the AI coding kernel. Before starting any substantive work, read these files in order:

1. `AI_index.md` — project snapshot of the kernel rules
2. `.ai/shared/agreements.md` — cross-project execution agreements
3. `handoff.md` — current project control state
4. `.ai/project-overrides.md` — project-specific rules (if present)
5. `.ai/shared/style-invariants.md` — code style and architecture invariants
6. `.ai/shared/task-template.md` — standard task format for spec/tasks.md

### Agents

| Agent | Role |
|-------|------|
| Claude Code | Coordinator + Planner + Plan-Fix (you) |
| Codex | Parallel Executor + Code-Fix |
| Antigravity | Independent Reviewer (Google) |

### Three Operating Modes

| Mode | When | Stages |
|------|------|--------|
| Lite | small fixes, single file, low risk | Plan(guard+restate) → Execute → Review → Close |
| Standard | cross-module, low-medium risk, single agent | Plan(guard+restate+tasks) → Execute → Code Review → Fix → Close |
| Full | high risk, multi-agent parallel, core systems | Plan → Review Plan → Fix Plan → Execute → Review Code → Fix Code → Release → Retro |

Default to Lite. Escalate based on risk and scope.

### Key Rules

- In Lite Mode, produce a restate block (Goal / Plan / Risks) before any code change.
- In Standard and Full Mode, all tasks in `spec/tasks.md` must use the template format (goal, constraints, ask_agent_first, owner, scope, rollback, acceptance).
- After producing spec, run `/init` to update CLAUDE.md with project context (first time or when context is stale).
- After planning, hand off to Antigravity for review (Full Mode only). Fix critical findings before proceeding.
- Delegate implementation to Codex for parallel execution. After code review by Antigravity, Codex fixes findings.
- Maintain `handoff.md` as the control token. When Owner is Human, stop and wait.
- Read `.ai/shared/style-invariants.md` before writing code to prevent architectural drift.
- Every task must have a concrete rollback plan.
- Write reusable lessons to `.ai/shared/lessons.md` via `.ai/scripts/promote-lesson.sh`.

# END AI_KERNEL
KERNEL_EOF
)

  if [ ! -f "$claude_md" ]; then
    printf "%s\n" "$kernel_block" > "$claude_md"
    echo "created $claude_md"
    return
  fi

  if grep -qF "$marker_begin" "$claude_md" 2>/dev/null; then
    echo "kept $claude_md (kernel block exists)"
    return
  fi

  {
    printf "\n%s\n" "$kernel_block"
  } >> "$claude_md"
  echo "updated $claude_md (appended kernel block)"
}

ensure_claude_md

# --- Meta manifest ---

KERNEL_VERSION=$(cd "$ROOT_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "no-git")

cat > "$TARGET_DIR/.ai/meta-manifest.md" <<EOF
# Meta Manifest

- source: $ROOT_DIR
- kernel_version: $KERNEL_VERSION
- synced_at: $(date "+%Y-%m-%d %H:%M:%S %Z")
- mode: bootstrap
- snapshot_policy: frozen
EOF

for snapshot_file in "${SNAPSHOT_FILES[@]}"; do
  printf -- "- snapshot_file: %s\n" "$snapshot_file" >> "$TARGET_DIR/.ai/meta-manifest.md"
done

echo "bootstrap complete for $TARGET_DIR"
