#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[fe-radar-backup] %s\n' "$*"
}

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    log "missing required env: ${name}"
    exit 1
  fi
}

read_secret() {
  local direct_name="$1"
  local file_name="$2"
  local direct_value="${!direct_name:-}"
  local file_value="${!file_name:-}"

  if [[ -n "$direct_value" ]]; then
    printf '%s' "$direct_value"
    return 0
  fi

  if [[ -n "$file_value" && -f "$file_value" ]]; then
    cat "$file_value"
    return 0
  fi

  log "missing required secret: ${direct_name} or ${file_name}"
  exit 1
}

cleanup() {
  if [[ -n "${DUMP_FILE:-}" && -f "$DUMP_FILE" ]]; then
    rm -f "$DUMP_FILE"
  fi
}

trap cleanup EXIT

require_env DATABASE_URL
require_env MINIO_ENDPOINT

MINIO_ALIAS="${MINIO_ALIAS:-fe-radar-backup}"
MINIO_BUCKET="${MINIO_BUCKET:-fe-radar-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-${BACKUP_RETENTION_DAYS:-7}}"
BACKUP_DATE="$(date -u +%Y-%m-%d)"
DUMP_FILE="/tmp/fe-radar-pg-${BACKUP_DATE}.dump"
REMOTE_PATH="${MINIO_ALIAS}/${MINIO_BUCKET}/${BACKUP_DATE}/pg-dump.dump"
RETENTION_HOURS=$((RETENTION_DAYS * 24))

MINIO_ACCESS_KEY_VALUE="$(read_secret MINIO_ACCESS_KEY MINIO_ACCESS_KEY_FILE)"
MINIO_SECRET_KEY_VALUE="$(read_secret MINIO_SECRET_KEY MINIO_SECRET_KEY_FILE)"

log "starting postgres dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner --file="$DUMP_FILE"

log "configuring minio alias ${MINIO_ALIAS}"
mc alias set "$MINIO_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY_VALUE" "$MINIO_SECRET_KEY_VALUE"

log "ensuring bucket ${MINIO_BUCKET}"
mc mb --ignore-existing "${MINIO_ALIAS}/${MINIO_BUCKET}"

log "uploading dump to ${REMOTE_PATH}"
mc cp "$DUMP_FILE" "$REMOTE_PATH"

log "removing backups older than ${RETENTION_HOURS}h"
mc rm --recursive --force --older-than "${RETENTION_HOURS}h" "${MINIO_ALIAS}/${MINIO_BUCKET}" || true

log "backup completed path=${MINIO_BUCKET}/${BACKUP_DATE}/pg-dump.dump retention_days=${RETENTION_DAYS}"
