#!/usr/bin/env sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${MINIO_ALIAS:?MINIO_ALIAS is required}"
: "${MINIO_ENDPOINT:?MINIO_ENDPOINT is required}"
: "${MINIO_ROOT_USER_FILE:?MINIO_ROOT_USER_FILE is required}"
: "${MINIO_ROOT_PASSWORD_FILE:?MINIO_ROOT_PASSWORD_FILE is required}"
: "${MINIO_BUCKET:=fe-radar-backup}"
: "${BACKUP_RETENTION_DAYS:=7}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="/tmp/fe-radar-${timestamp}.dump"
minio_user="$(cat "$MINIO_ROOT_USER_FILE")"
minio_password="$(cat "$MINIO_ROOT_PASSWORD_FILE")"

pg_dump "$DATABASE_URL" --format=custom --no-owner --file="$dump"
mc alias set "$MINIO_ALIAS" "$MINIO_ENDPOINT" "$minio_user" "$minio_password"
mc mb --ignore-existing "${MINIO_ALIAS}/${MINIO_BUCKET}"
mc cp "$dump" "${MINIO_ALIAS}/${MINIO_BUCKET}/postgres/${timestamp}.dump"

cutoff="$(date -u -v-"${BACKUP_RETENTION_DAYS}"d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "-${BACKUP_RETENTION_DAYS} days" +%Y-%m-%dT%H:%M:%SZ)"
mc find "${MINIO_ALIAS}/${MINIO_BUCKET}/postgres" --older-than "${BACKUP_RETENTION_DAYS}d" --exec "mc rm {}"

echo "backup=${timestamp} retention_cutoff=${cutoff}"
