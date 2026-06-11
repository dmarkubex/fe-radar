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

if [ -n "${REQUIRE_DB_TABLES:-}" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "missing required env: DATABASE_URL for REQUIRE_DB_TABLES" >&2
    exit 1
  fi

  DB_WAIT_TIMEOUT_SECONDS="${DB_WAIT_TIMEOUT_SECONDS:-180}"
  if ! command -v psql >/dev/null 2>&1; then
    echo "missing psql client required by REQUIRE_DB_TABLES" >&2
    exit 1
  fi

  deadline=$(( $(date +%s) + DB_WAIT_TIMEOUT_SECONDS ))
  tables=$(printf '%s' "$REQUIRE_DB_TABLES" | tr ',' ' ')
  while :; do
    missing=""
    for table in $tables; do
      table_sql=$(printf '%s' "$table" | sed "s/'/''/g")
      if ! regclass=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atqc "select to_regclass('$table_sql')" 2>/tmp/fe-radar-db-probe.err); then
        echo "database schema probe query failed: $(cat /tmp/fe-radar-db-probe.err)" >&2
        missing="database_unreachable"
        break
      fi
      if [ -z "$regclass" ]; then
        missing="${missing} ${table}"
      fi
    done

    if [ -z "$missing" ]; then
      break
    fi

    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "database schema probe timed out after ${DB_WAIT_TIMEOUT_SECONDS}s; missing:${missing}" >&2
      exit 1
    fi

    echo "waiting for database schema; missing:${missing}" >&2
    sleep 5
  done
fi

exec "$@"
