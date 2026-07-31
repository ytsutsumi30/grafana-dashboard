const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { dashboardUid, prepareDashboardImport } = require("../server/dashboard-import-policy");

const root = path.resolve(__dirname, "..");
const sample = { dashboard: { uid: "sample-dashboard", title: "Sample", panels: [] }, overwrite: false };

assert.strictEqual(dashboardUid(sample), "sample-dashboard");
assert.strictEqual(prepareDashboardImport(sample, { exists: false }).overwrite, false);
assert.strictEqual(prepareDashboardImport(sample, { exists: true, overwrite: true }).overwrite, true);
assert.throws(
  () => prepareDashboardImport(sample, { exists: true, overwrite: false }),
  /Set OVERWRITE_DASHBOARD=true/
);

const dashboardsDir = path.join(root, "dashboards");
for (const name of fs.readdirSync(dashboardsDir).filter((value) => value.endsWith(".json"))) {
  const filePath = path.join(dashboardsDir, name);
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.strictEqual(payload.overwrite, false, `${name} must be safe by default`);
  assert.ok(dashboardUid(payload), `${name} must have a UID`);
}

const powerDashboard = path.join(dashboardsDir, "power-monitoring-dashboard.json");
const safeRender = spawnSync(process.execPath, ["scripts/materialize-dashboard-json.js", powerDashboard], {
  cwd: root,
  encoding: "utf8"
});
assert.strictEqual(safeRender.status, 0, safeRender.stderr);
assert.strictEqual(JSON.parse(safeRender.stdout).overwrite, false);

const explicitRender = spawnSync(process.execPath, ["scripts/materialize-dashboard-json.js", powerDashboard, "--overwrite"], {
  cwd: root,
  encoding: "utf8"
});
assert.strictEqual(explicitRender.status, 0, explicitRender.stderr);
assert.strictEqual(JSON.parse(explicitRender.stdout).overwrite, true);

for (const name of ["setup-grafana-wsl2.sh", "setup-power-monitoring-dashboard-cloud.sh"]) {
  const source = fs.readFileSync(path.join(root, "scripts", name), "utf8");
  assert.match(source, /OVERWRITE_DASHBOARD/);
  assert.match(source, /already exists/);
  assert.match(source, /--overwrite/);
}

console.log("OK static dashboard imports require explicit overwrite.");
