#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DASHBOARD_JSON="${DASHBOARD_JSON:-$ROOT_DIR/dashboards/power-monitoring-dashboard.json}"
DATASOURCE_UID="${DATASOURCE_UID:-testdata}"
DATASOURCE_NAME="${DATASOURCE_NAME:-TestData}"
DASHBOARD_UID="${DASHBOARD_UID:-power-monitoring-demo}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required." >&2
    exit 1
  fi
}

api() {
  local method="$1"
  local path="$2"
  shift 2

  curl -fsS \
    -X "$method" \
    -H "Authorization: Bearer $GRAFANA_CLOUD_TOKEN" \
    -H "Content-Type: application/json" \
    "$@" \
    "$GRAFANA_URL$path"
}

require_env "GRAFANA_URL"
require_env "GRAFANA_CLOUD_TOKEN"

GRAFANA_URL="${GRAFANA_URL%/}"

if [[ ! -f "$DASHBOARD_JSON" ]]; then
  echo "ERROR: dashboard JSON not found: $DASHBOARD_JSON" >&2
  exit 1
fi

echo "Checking Grafana Cloud health..."
api GET "/api/health" >/dev/null

echo "Checking datasource uid=$DATASOURCE_UID..."
if api GET "/api/datasources/uid/$DATASOURCE_UID" >/dev/null 2>&1; then
  echo "Datasource already exists: $DATASOURCE_UID"
else
  echo "Creating TestData datasource: $DATASOURCE_UID"
  api POST "/api/datasources" \
    --data-binary @- <<JSON
{
  "name": "$DATASOURCE_NAME",
  "uid": "$DATASOURCE_UID",
  "type": "grafana-testdata-datasource",
  "access": "proxy",
  "isDefault": false,
  "jsonData": {}
}
JSON
  echo
fi

echo "Uploading dashboard: $DASHBOARD_UID"
api POST "/api/dashboards/db" --data-binary "@$DASHBOARD_JSON" >/dev/null

echo "Verifying dashboard..."
api GET "/api/dashboards/uid/$DASHBOARD_UID" >/dev/null

echo "Done."
echo "Dashboard URL: $GRAFANA_URL/d/$DASHBOARD_UID/power-monitoring-iot-demo"
