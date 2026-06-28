#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export GRAFANA_PORT="${GRAFANA_PORT:-3031}"
export DASHBOARD_JSON="$ROOT_DIR/dashboards/press-maintenance-dashboard.json"

"$ROOT_DIR/scripts/setup-grafana-wsl2.sh"

