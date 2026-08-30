"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

process.env.APP_AUTH_MODE = "none";
delete process.env.K_SERVICE;
delete process.env.K_REVISION;

const {
  VISUALIZATIONS,
  normalizePanel,
  validatePanelDrafts,
  grafanaPanel
} = require("../server/grafana-dashboard-builder");

const gridPos = { x: 0, y: 0, w: 12, h: 8 };
const basePanel = {
  title: "Extended visualization test",
  unit: "percent",
  min: 0,
  max: 100,
  warningThreshold: 75,
  criticalThreshold: 90,
  riskDirection: "high",
  purpose: "Verify Grafana visualization JSON",
  rationale: "Automated contract test",
  proposalSource: "manual",
  rangeSource: "testdata-demo-default",
  latestOnly: false,
  scenarioId: "random_walk"
};

for (const visualization of ["barchart", "bargauge", "heatmap"]) {
  assert.ok(VISUALIZATIONS.has(visualization), `${visualization} must be an allowed visualization.`);
  const draft = { ...basePanel, visualization };
  assert.deepStrictEqual(validatePanelDrafts([{ ...draft, gridPos }]), []);
  const panel = grafanaPanel(draft, 0, gridPos);
  assert.strictEqual(panel.type, visualization);
  assert.strictEqual(panel.datasource.uid, "testdata");
  assert.strictEqual(panel.targets[0].scenarioId, "random_walk");
  assert.strictEqual(panel.fieldConfig.defaults.unit, "percent");
}

const barChart = grafanaPanel({ ...basePanel, visualization: "barchart" }, 0, gridPos);
assert.strictEqual(barChart.options.stacking, "none");
assert.strictEqual(barChart.options.orientation, "auto");
assert.strictEqual(barChart.options.legend.showLegend, true);

const barGaugeDraft = normalizePanel({ ...basePanel, visualization: "bargauge" }, 0);
assert.strictEqual(barGaugeDraft.latestOnly, true);
const barGauge = grafanaPanel(barGaugeDraft, 0, gridPos);
assert.strictEqual(barGauge.options.orientation, "horizontal");
assert.strictEqual(barGauge.options.displayMode, "gradient");
assert.deepStrictEqual(barGauge.options.reduceOptions.calcs, ["lastNotNull"]);

const heatmap = grafanaPanel({ ...basePanel, visualization: "heatmap", unit: "accMS2" }, 0, gridPos);
assert.strictEqual(heatmap.options.calculate, true);
assert.strictEqual(heatmap.options.color.mode, "scheme");
assert.strictEqual(heatmap.options.yAxis.unit, "accMS2");

const html = fs.readFileSync(path.join(__dirname, "..", "public", "grafana-sales-dashboard-builder.html"), "utf8");
for (const visualization of ["barchart", "bargauge", "heatmap"]) {
  assert.match(html, new RegExp(`value=["']${visualization}["']`), `${visualization} must be selectable in the panel dialog.`);
  assert.match(html, new RegExp(`panel\\.visualization === ["']${visualization}["']`), `${visualization} must have a preview renderer.`);
}
assert.match(html, /function renderBarChartPreview/);
assert.match(html, /function renderBarGaugePreview/);
assert.match(html, /function renderHeatmapPreview/);

console.log("OK Grafana bar chart, bar gauge, and heatmap JSON/UI contracts.");
