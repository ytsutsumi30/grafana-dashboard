#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAFANA_PORT="${GRAFANA_PORT:-3030}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:$GRAFANA_PORT}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-admin}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-codex-grafana}"
TOKEN_NAME="${TOKEN_NAME:-codex-grafana-token}"
DATASOURCE_NAME="${DATASOURCE_NAME:-TestData}"
DATASOURCE_UID="${DATASOURCE_UID:-testdata}"
DASHBOARD_JSON="${DASHBOARD_JSON:-$ROOT_DIR/dashboards/ship-sensor-dashboard.json}"

export GRAFANA_PORT
export GRAFANA_ADMIN_USER
export GRAFANA_ADMIN_PASSWORD

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing command: $1" >&2
    exit 1
  fi
}

api_basic() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"

  if [[ -n "$payload" ]]; then
    curl -fsS -X "$method" "$GRAFANA_URL$path" \
      -u "$GRAFANA_ADMIN_USER:$GRAFANA_ADMIN_PASSWORD" \
      -H "Content-Type: application/json" \
      -d "$payload"
  else
    curl -fsS -X "$method" "$GRAFANA_URL$path" \
      -u "$GRAFANA_ADMIN_USER:$GRAFANA_ADMIN_PASSWORD"
  fi
}

api_token() {
  local method="$1"
  local path="$2"
  local token="$3"
  local payload="${4:-}"

  if [[ -n "$payload" ]]; then
    curl -fsS -X "$method" "$GRAFANA_URL$path" \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      -d "$payload"
  else
    curl -fsS -X "$method" "$GRAFANA_URL$path" \
      -H "Authorization: Bearer $token"
  fi
}

wait_for_grafana() {
  echo "Waiting for Grafana at $GRAFANA_URL ..."
  for _ in {1..60}; do
    local health
    health="$(curl -fsS "$GRAFANA_URL/api/health" 2>/dev/null || true)"
    if [[ -n "$health" ]] && jq -e '.database and .version' >/dev/null 2>&1 <<<"$health"; then
      echo "Grafana is ready."
      return
    fi
    sleep 2
  done

  echo "Grafana did not become ready in time at $GRAFANA_URL." >&2
  echo "If another app is using port $GRAFANA_PORT, rerun with a different port, for example:" >&2
  echo "  GRAFANA_PORT=3030 ./scripts/setup-grafana-wsl2.sh" >&2
  exit 1
}

create_service_account_token() {
  local account_id
  local existing
  local created
  local token

  existing="$(api_basic GET "/api/serviceaccounts/search?query=$SERVICE_ACCOUNT_NAME" | jq -r --arg name "$SERVICE_ACCOUNT_NAME" '.serviceAccounts[]? | select(.name == $name) | .id' | head -n 1)"

  if [[ -n "$existing" ]]; then
    account_id="$existing"
    echo "Using existing service account id: $account_id"
  else
    created="$(api_basic POST "/api/serviceaccounts" "$(jq -n --arg name "$SERVICE_ACCOUNT_NAME" '{name: $name, role: "Admin"}')")"
    account_id="$(jq -r '.id' <<<"$created")"
    echo "Created service account id: $account_id"
  fi

  token="$(api_basic POST "/api/serviceaccounts/$account_id/tokens" "$(jq -n --arg name "$TOKEN_NAME-$(date +%Y%m%d%H%M%S)" '{name: $name}')")"
  jq -r '.key' <<<"$token"
}

upsert_testdata_datasource() {
  local token="$1"
  local existing_uid
  local payload

  payload="$(jq -n \
    --arg name "$DATASOURCE_NAME" \
    --arg uid "$DATASOURCE_UID" \
    '{
      name: $name,
      uid: $uid,
      type: "grafana-testdata-datasource",
      access: "proxy",
      isDefault: true
    }')"

  existing_uid="$(api_token GET "/api/datasources/uid/$DATASOURCE_UID" "$token" 2>/dev/null | jq -r '.uid // empty' || true)"

  if [[ "$existing_uid" == "$DATASOURCE_UID" ]]; then
    api_token PUT "/api/datasources/uid/$DATASOURCE_UID" "$token" "$payload" >/dev/null
    echo "Updated datasource: $DATASOURCE_UID"
  else
    api_token POST "/api/datasources" "$token" "$payload" >/dev/null
    echo "Created datasource: $DATASOURCE_UID"
  fi
}

import_dashboard() {
  local token="$1"
  local response
  response="$(api_token POST "/api/dashboards/db" "$token" "$(cat "$DASHBOARD_JSON")")"
  echo "$response" | jq -r '"Dashboard imported: " + .url'
  DASHBOARD_URL="$(jq -r '.url' <<<"$response")"
}

main() {
  need_command curl
  need_command jq
  need_command docker

  cd "$ROOT_DIR"

  echo "Starting Grafana with Docker Compose ..."
  docker compose up -d

  wait_for_grafana

  echo "Creating service account token ..."
  local token
  token="$(create_service_account_token | tail -n 1)"

  echo "Configuring TestData datasource ..."
  upsert_testdata_datasource "$token"

  echo "Importing dashboard ..."
  local DASHBOARD_URL
  import_dashboard "$token"

  echo
  echo "Open: $GRAFANA_URL$DASHBOARD_URL"
  echo "Login: $GRAFANA_ADMIN_USER / $GRAFANA_ADMIN_PASSWORD"
}

main "$@"
