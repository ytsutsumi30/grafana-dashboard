"use strict";

const assert = require("node:assert");
const {
  MAX_PROCESS_PANELS,
  manufacturingProcessProfiles,
  findManufacturingProcessProfiles,
  selectBalancedPanels,
  buildManufacturingProcessProfile,
  buildManufacturingProcessReference
} = require("../server/manufacturing-process-profiles");

const expectedKeys = [
  "press",
  "heat-treatment",
  "plating",
  "edm",
  "grinding",
  "welding",
  "machining",
  "bending",
  "special-processing"
];

assert.deepStrictEqual(manufacturingProcessProfiles.map((profile) => profile.key), expectedKeys);
for (const profile of manufacturingProcessProfiles) {
  assert.ok(profile.equipment.length > 0, `${profile.key} must include equipment.`);
  assert.ok(profile.applications.length > 0, `${profile.key} must include applications.`);
  assert.ok(profile.monitoringTargets.length > 0, `${profile.key} must include monitoring targets.`);
  assert.ok(profile.panels.length >= 5, `${profile.key} must include at least five panels.`);
}

const expectedExtendedVisualizations = [
  ["press", "Press Stroke Count", "barchart"],
  ["plating", "Bath Liquid Level", "bargauge"],
  ["grinding", "Spindle Bearing Vibration", "heatmap"]
];
for (const [profileKey, title, visualization] of expectedExtendedVisualizations) {
  const profile = manufacturingProcessProfiles.find((candidate) => candidate.key === profileKey);
  const panel = profile?.panels.find((candidate) => candidate[0] === title);
  assert.ok(panel, `${profileKey} must include ${title}.`);
  assert.strictEqual(panel[1], visualization, `${title} must use ${visualization}.`);
}

for (const profile of manufacturingProcessProfiles) {
  const matches = findManufacturingProcessProfiles({ processes: [profile.label], equipment: [] });
  assert.ok(matches.some((candidate) => candidate.key === profile.key), `${profile.label} must resolve to ${profile.key}.`);
}

const bendingOnly = findManufacturingProcessProfiles({ processes: [], equipment: ["NCプレスブレーキ"] });
assert.deepStrictEqual(bendingOnly.map((profile) => profile.key), ["bending"], "Press brake must not be misclassified as stamping press.");

const ncLathe = findManufacturingProcessProfiles({ processes: [], equipment: ["NC旋盤"] });
assert.deepStrictEqual(ncLathe.map((profile) => profile.key), ["machining"], "NC lathe must resolve to machining.");

const allProcesses = {
  processes: ["プレス", "熱処理", "鍍金", "放電", "研磨", "溶接", "切削", "曲げ", "特殊加工"],
  equipment: []
};
const allMatches = findManufacturingProcessProfiles(allProcesses);
assert.strictEqual(allMatches.length, expectedKeys.length);
const selected = selectBalancedPanels(allMatches);
assert.strictEqual(selected.length, MAX_PROCESS_PANELS);
for (const profile of allMatches) {
  assert.ok(selected.some((panel) => panel.processKey === profile.key), `${profile.key} must contribute a primary panel.`);
}

const composite = buildManufacturingProcessProfile({
  processes: ["プレス", "切削"],
  equipment: ["油圧プレス", "CNC旋盤"]
});
assert.deepStrictEqual(composite.matchedProcesses, ["press", "machining"]);
assert.ok(composite.panels.some((panel) => panel.title === "Press Load Peak"));
assert.ok(composite.panels.some((panel) => panel.title === "Spindle Load Torque"));
assert.ok(composite.panels.every((panel) => panel.proposalSource === "process-catalog"));
assert.ok(composite.panels.every((panel) => panel.rangeSource === "testdata-demo-default"));
assert.ok(composite.panels.every((panel) => panel.rationale));

const sheetMetal = buildManufacturingProcessProfile("板金加工業者");
assert.ok(sheetMetal.matchedProcesses.includes("bending"), "Sheet metal industry must resolve to bending.");
assert.ok(sheetMetal.panels[0].title === "Bending Force", "A process-specific panel must be first.");

const pressBrakeIndustry = findManufacturingProcessProfiles("NCプレスブレーキ");
assert.deepStrictEqual(pressBrakeIndustry.map((profile) => profile.key), ["bending"]);

const weighted = buildManufacturingProcessProfile(allProcesses, { primaryProcess: "welding" });
const weldingCount = weighted.panels.filter((panel) => panel.processKey === "welding").length;
const heatTreatmentCount = weighted.panels.filter((panel) => panel.processKey === "heat-treatment").length;
assert.ok(weldingCount > heatTreatmentCount, "Primary process must receive more panel capacity.");

const equipmentFiltered = buildManufacturingProcessProfile(allProcesses, {
  selectedEquipment: ["CNC旋盤"]
});
assert.deepStrictEqual(equipmentFiltered.matchedProcesses, ["machining"]);
assert.ok(equipmentFiltered.panels.every((panel) => panel.equipment.includes("CNC旋盤")));

assert.strictEqual(
  new Set(composite.panels.map((panel) => panel.title.toLowerCase())).size,
  composite.panels.length,
  "Composite process panels must not contain duplicate titles."
);

const reference = buildManufacturingProcessReference({
  processes: ["鍍金"],
  equipment: ["自動めっきライン"]
});
assert.match(reference, /整流器電流・電圧/);
assert.match(reference, /個社の確認済み仕様ではない/);
assert.match(reference, /TestDataの範囲は編集可能なデモ値/);

console.log("OK manufacturing process catalog, matching, balanced selection, and AI reference context.");
