const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dashboardDir = path.join(root, "dashboards");

function fail(message) {
  console.error(`NG ${message}`);
  process.exitCode = 1;
}

function ok(message) {
  console.log(`OK ${message}`);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${path.relative(root, filePath)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateDashboard(filePath) {
  const payload = readJson(filePath);
  const label = path.relative(root, filePath);
  if (!payload) return;

  const dashboard = payload.dashboard && typeof payload.dashboard === "object" ? payload.dashboard : payload;

  if (!dashboard.uid || typeof dashboard.uid !== "string") {
    fail(`${label}: dashboard.uid must be a non-empty string`);
  }
  if (!dashboard.title || typeof dashboard.title !== "string") {
    fail(`${label}: dashboard.title must be a non-empty string`);
  }
  if (!Array.isArray(dashboard.panels) || dashboard.panels.length === 0) {
    fail(`${label}: dashboard.panels must include at least one panel`);
    return;
  }

  const panelIds = new Set();
  for (const panel of dashboard.panels) {
    if (!panel || typeof panel !== "object") {
      fail(`${label}: every panel must be an object`);
      continue;
    }
    if (!panel.id || panelIds.has(panel.id)) {
      fail(`${label}: panel ids must be present and unique`);
    }
    panelIds.add(panel.id);
    if (!panel.title || typeof panel.title !== "string") {
      fail(`${label}: panel ${panel.id || "(unknown)"} title must be a non-empty string`);
    }
    if (!panel.type || typeof panel.type !== "string") {
      fail(`${label}: panel ${panel.title || panel.id || "(unknown)"} type must be a non-empty string`);
    }
    if (!panel.gridPos || typeof panel.gridPos !== "object") {
      fail(`${label}: panel ${panel.title || panel.id || "(unknown)"} gridPos is required`);
    }
  }

  ok(`${label} panels=${dashboard.panels.length}`);
}

const dashboardFiles = fs
  .readdirSync(dashboardDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => path.join(dashboardDir, name));

if (dashboardFiles.length === 0) {
  fail("dashboards directory must include at least one JSON dashboard");
} else {
  dashboardFiles.forEach(validateDashboard);
}

if (process.exitCode) {
  process.exit(process.exitCode);
}
