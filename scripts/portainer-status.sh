#!/usr/bin/env bash
# Read-only Portainer status for FE-Radar.
# Uses Codex skill credentials (never prints secrets).
set -euo pipefail

ENV_FILE="${PORTAINER_ENV_FILE:-$HOME/.codex/skills/harbor-portainer-stack-deploy/.env}"
MATCH="${1:-fe-radar}"
ENDPOINT="${PORTAINER_ENDPOINT_ID:-3}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing credentials file: $ENV_FILE" >&2
  echo "expected Codex skill env at ~/.codex/skills/harbor-portainer-stack-deploy/.env" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# load KEY=VALUE without exporting comments
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" == *=* ]] || continue
  key="${line%%=*}"
  val="${line#*=}"
  key="$(echo "$key" | xargs)"
  export "$key=$val"
done < "$ENV_FILE"
set +a

export PORTAINER_INSECURE="${PORTAINER_INSECURE:-1}"

echo "== Portainer connection =="
echo "URL      : ${PORTAINER_URL:-unset}"
echo "Endpoint : $ENDPOINT (${PORTAINER_ENDPOINT:-local})"
echo "Match    : $MATCH"
echo

node "$HOME/.codex/skills/portainer-container-restart/scripts/portainer_check_restart.mjs" \
  --endpoint "$ENDPOINT" \
  --match "$MATCH" \
  --json
