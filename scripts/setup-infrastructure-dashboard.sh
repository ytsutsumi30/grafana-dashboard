#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export DASHBOARD_JSON="$ROOT_DIR/dashboards/infrastructure-overview.json"

"$ROOT_DIR/scripts/setup-grafana-wsl2.sh"

