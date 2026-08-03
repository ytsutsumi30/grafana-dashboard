const fs = require("fs");
const path = require("path");
const { dashboardUid, prepareDashboardImport } = require("../server/dashboard-import-policy");

const GRAFANA_URL = (process.env.GRAFANA_URL || "https://ytsutsumi30.grafana.net").replace(/\/$/, "");
const TOKEN = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || process.env.GRAFANA_CLOUD_TOKEN || "";
const API_BASE_URL = (process.env.MOBILE_SENSOR_API_BASE_URL || "").replace(/\/$/, "");
const DASHBOARD_PATH = path.resolve(__dirname, "../dashboards/android-vibration-sensor-dashboard.json");
const OVERWRITE_DASHBOARD = String(process.env.OVERWRITE_DASHBOARD || "false").toLowerCase() === "true";

async function grafana(endpoint, options = {}) {
  if (!TOKEN) {
    throw new Error("GRAFANA_SERVICE_ACCOUNT_TOKEN or GRAFANA_CLOUD_TOKEN is not set.");
  }
  const { allowNotFound = false, ...fetchOptions } = options;
  const response = await fetch(`${GRAFANA_URL}${endpoint}`, {
    ...fetchOptions,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${data.message || text}`);
  }
  return data;
}

async function main() {
  if (!API_BASE_URL) {
    throw new Error("MOBILE_SENSOR_API_BASE_URL is not set.");
  }
  await grafana("/api/health");
  await grafana("/api/datasources/uid/grafanacloud-infinity");
  const source = JSON.parse(fs.readFileSync(DASHBOARD_PATH, "utf8").replaceAll("__API_BASE_URL__", API_BASE_URL));
  const uid = dashboardUid(source);
  const exists = Boolean(await grafana(`/api/dashboards/uid/${encodeURIComponent(uid)}`, { allowNotFound: true }));
  const dashboard = prepareDashboardImport(source, { exists, overwrite: OVERWRITE_DASHBOARD });
  const result = await grafana("/api/dashboards/db", {
    method: "POST",
    body: JSON.stringify(dashboard)
  });
  const url = result.url ? `${GRAFANA_URL}${result.url}` : `${GRAFANA_URL}/d/android-vibration-sensor-demo/android-vibration-sensor-demo`;
  console.log(`Android vibration sensor dashboard created: ${url}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
