const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  thresholdValues,
  thresholdOrderIsValid,
  grafanaThresholdSteps
} = require("../server/panel-thresholds");

assert.deepStrictEqual(
  grafanaThresholdSteps(0, 100, "percent", 80, 90, "high"),
  [
    { color: "green", value: null },
    { color: "yellow", value: 80 },
    { color: "red", value: 90 }
  ]
);
assert.deepStrictEqual(
  grafanaThresholdSteps(40, 100, "percent", 76, 64, "low"),
  [
    { color: "red", value: null },
    { color: "yellow", value: 64 },
    { color: "green", value: 76 }
  ]
);
assert.deepStrictEqual(
  grafanaThresholdSteps(10, 40, "celsius", 17.5, 32.5, "outside"),
  [
    { color: "red", value: null },
    { color: "green", value: 17.5 },
    { color: "red", value: 32.5 }
  ]
);
assert.deepStrictEqual(thresholdValues(40, 100, "percent", "low"), { warning: 76, critical: 64 });
assert.strictEqual(thresholdOrderIsValid("high", 80, 90), true);
assert.strictEqual(thresholdOrderIsValid("low", 76, 64), true);
assert.strictEqual(thresholdOrderIsValid("outside", 20, 80), true);
assert.strictEqual(thresholdOrderIsValid("low", 64, 76), false);

const serverSource = fs.readFileSync(path.join(__dirname, "..", "server", "grafana-dashboard-builder.js"), "utf8");
assert.match(
  serverSource,
  /const validationErrors = validatePanelDrafts\(panels\);[\s\S]*AI proposal response failed panel validation/,
  "AI proposals must be validated after normalization so invalid low-risk threshold ordering falls back safely"
);

console.log("OK risk-direction threshold rules");
