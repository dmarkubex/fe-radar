#!/usr/bin/env bash
set -euo pipefail

log() {
  printf '[fe-radar-minio-provision] %s\n' "$*"
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

require_env MINIO_ENDPOINT

MINIO_ALIAS="${MINIO_ALIAS:-fe-radar}"
BRIEFING_MINIO_BUCKET="${BRIEFING_MINIO_BUCKET:-fe-radar-briefings}"
BACKUP_MINIO_BUCKET="${BACKUP_MINIO_BUCKET:-fe-radar-backups}"
BRIEFING_RETENTION_DAYS="${BRIEFING_RETENTION_DAYS:-90}"

MINIO_ACCESS_KEY_VALUE="$(read_secret MINIO_ACCESS_KEY MINIO_ACCESS_KEY_FILE)"
MINIO_SECRET_KEY_VALUE="$(read_secret MINIO_SECRET_KEY MINIO_SECRET_KEY_FILE)"
LIFECYCLE_FILE="$(mktemp)"
trap 'rm -f "$LIFECYCLE_FILE"' EXIT

cat > "$LIFECYCLE_FILE" <<JSON
{
  "Rules": [
    {
      "ID": "briefing-docx-retention",
      "Status": "Enabled",
      "Expiration": {
        "Days": ${BRIEFING_RETENTION_DAYS}
      }
    }
  ]
}
JSON

log "configuring minio alias ${MINIO_ALIAS}"
mc alias set "$MINIO_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY_VALUE" "$MINIO_SECRET_KEY_VALUE"

log "ensuring bucket ${BRIEFING_MINIO_BUCKET}"
mc mb --ignore-existing "${MINIO_ALIAS}/${BRIEFING_MINIO_BUCKET}"

log "ensuring bucket ${BACKUP_MINIO_BUCKET}"
mc mb --ignore-existing "${MINIO_ALIAS}/${BACKUP_MINIO_BUCKET}"

log "applying ${BRIEFING_RETENTION_DAYS}d lifecycle to ${BRIEFING_MINIO_BUCKET}"
mc ilm import "${MINIO_ALIAS}/${BRIEFING_MINIO_BUCKET}" < "$LIFECYCLE_FILE"
mc ilm ls "${MINIO_ALIAS}/${BRIEFING_MINIO_BUCKET}"

log "minio provisioning completed"
