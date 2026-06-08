#!/bin/sh
# FE-Radar entrypoint: hydrate Docker *_FILE secrets into plain env vars.
#
# Why: stack.yml points env vars like NEXTAUTH_SECRET_FILE / DEEPSEEK_API_KEY_FILE
# at Docker secret mounts (/run/secrets/...), but the application code reads the
# PLAIN name (NEXTAUTH_SECRET, DEEPSEEK_API_KEY, ...). For each FOO_FILE that
# points at a readable file, this exports FOO=<file contents>.
#
# No-op when no *_FILE vars are set, so plain-env deploys (first smoke) work
# unchanged. POSIX sh — runs in both alpine (ash) and debian-slim images.
set -eu

for file_var in $(env | grep -E '^[A-Za-z_][A-Za-z0-9_]*_FILE=' | cut -d= -f1); do
  file_path=$(printenv "$file_var" 2>/dev/null || true)
  base_var=${file_var%_FILE}
  if [ -n "$file_path" ] && [ -f "$file_path" ]; then
    # command substitution strips the trailing newline secrets usually carry;
    # the value is expanded once by the shell, so secret contents are never re-evaluated.
    val=$(cat "$file_path")
    export "$base_var=$val"
  fi
done

exec "$@"
