const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  containsFixedIsoTimestamp,
  materializeDashboardRelativeTimes,
  materializeRelativeTimeTokens
} = require("../server/mock-csv-time");

const root = path.resolve(__dirname, "..");
const anchor = new Date("2030-01-30T12:00:00.000Z");
const csv = "time,value\n__NOW_MINUS_1D__,10\n__NOW_MINUS_30M__,20\n__NOW__,30";
const materialized = materializeRelativeTimeTokens(csv, anchor);

assert.strictEqual(
  materialized,
  "time,value\n2030-01-29T12:00:00.000Z,10\n2030-01-30T11:30:00.000Z,20\n2030-01-30T12:00:00.000Z,30"
);
assert.strictEqual(materialized.includes("__NOW"), false);
assert.strictEqual(containsFixedIsoTimestamp(materialized), true);
assert.throws(() => materializeRelativeTimeTokens("__NOW__", "invalid"), /valid time anchor/);

const dashboardsDir = path.join(root, "dashboards");
for (const name of fs.readdirSync(dashboardsDir).filter((value) => value.endsWith(".json"))) {
  const payload = JSON.parse(fs.readFileSync(path.join(dashboardsDir, name), "utf8"));
  const source = JSON.stringify(payload);
  assert.strictEqual(containsFixedIsoTimestamp(source), false, `${name} contains a fixed ISO timestamp`);
  const rendered = materializeDashboardRelativeTimes(payload, anchor);
  assert.strictEqual(JSON.stringify(rendered).includes("__NOW"), false, `${name} has an unresolved relative time token`);
}

const serverSource = fs.readFileSync(path.join(root, "server", "grafana-dashboard-builder.js"), "utf8");
assert.strictEqual(containsFixedIsoTimestamp(serverSource), false, "server templates contain a fixed ISO timestamp");
assert.match(serverSource, /target\.csvContent = materializeRelativeTimeTokens\(normalized\.csvContent\)/);

console.log("OK relative TestData timestamps");
