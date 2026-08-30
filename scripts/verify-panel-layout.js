const assert = require("assert");
const {
  GRID_COLUMNS,
  layoutPanels,
  normalizeGridPos,
  resolveGridPositions,
  validatePanelGridPositions
} = require("../server/panel-layout");

const panels = [
  { title: "Current", visualization: "stat" },
  { title: "Pressure", visualization: "gauge" },
  { title: "Daily Trend", visualization: "timeseries" },
  { title: "Status", visualization: "table" }
];

const automatic = layoutPanels(panels);
assert.deepStrictEqual(automatic[0], { x: 0, y: 0, w: 8, h: 5 });
assert.deepStrictEqual(automatic[1], { x: 8, y: 0, w: 8, h: 5 });
assert.deepStrictEqual(automatic[2], { x: 0, y: 5, w: 24, h: 9 });
assert.deepStrictEqual(automatic[3], { x: 0, y: 14, w: 12, h: 8 });
assert.ok(automatic.every((position) => position.x + position.w <= GRID_COLUMNS));

assert.deepStrictEqual(normalizeGridPos({ x: 12, y: 4, w: 12, h: 8 }), { x: 12, y: 4, w: 12, h: 8 });
assert.strictEqual(normalizeGridPos({ x: 13, y: 4, w: 12, h: 8 }), null);
assert.strictEqual(normalizeGridPos({ x: 0.5, y: 0, w: 12, h: 8 }), null);
assert.strictEqual(normalizeGridPos({ x: 0, y: 0, w: 0, h: 8 }), null);

const supplied = panels.map((panel, index) => ({ ...panel, gridPos: automatic[index] }));
assert.deepStrictEqual(validatePanelGridPositions(supplied), []);
assert.deepStrictEqual(resolveGridPositions(supplied), automatic);
assert.match(
  validatePanelGridPositions([{ ...panels[0], gridPos: automatic[0] }, panels[1]]).join(" "),
  /every panel/
);
assert.match(
  validatePanelGridPositions([
    { ...panels[0], gridPos: { x: 0, y: 0, w: 12, h: 8 } },
    { ...panels[1], gridPos: { x: 6, y: 4, w: 12, h: 8 } }
  ]).join(" "),
  /overlap/
);

console.log("OK panel gridPos validation and automatic layout");
