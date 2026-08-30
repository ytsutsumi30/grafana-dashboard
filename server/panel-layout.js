const GRID_COLUMNS = 24;
const MAX_GRID_HEIGHT = 1000;
const MAX_PANEL_HEIGHT = 50;

function defaultPanelSize(panel = {}) {
  const isSmall = panel.visualization === "stat" || panel.visualization === "gauge";
  const isWide = panel.visualization === "timeseries" && String(panel.title || "").toLowerCase().includes("trend");
  return isWide ? { w: 24, h: 9 } : isSmall ? { w: 8, h: 5 } : { w: 12, h: 8 };
}

function normalizeGridPos(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const gridPos = {
    x: Number(value.x),
    y: Number(value.y),
    w: Number(value.w),
    h: Number(value.h)
  };
  if (!Object.values(gridPos).every(Number.isInteger)) return null;
  if (gridPos.x < 0 || gridPos.y < 0 || gridPos.w < 1 || gridPos.h < 1) return null;
  if (gridPos.w > GRID_COLUMNS || gridPos.h > MAX_PANEL_HEIGHT) return null;
  if (gridPos.x + gridPos.w > GRID_COLUMNS || gridPos.y > MAX_GRID_HEIGHT) return null;
  return gridPos;
}

function overlaps(first, second) {
  return first.x < second.x + second.w &&
    first.x + first.w > second.x &&
    first.y < second.y + second.h &&
    first.y + first.h > second.y;
}

function validatePanelGridPositions(panels) {
  const rows = Array.isArray(panels) ? panels : [];
  const suppliedCount = rows.filter((panel) => panel?.gridPos !== undefined && panel?.gridPos !== null).length;
  if (suppliedCount === 0) return [];

  const errors = [];
  if (suppliedCount !== rows.length) {
    errors.push("gridPos must be supplied for every panel or omitted for every panel.");
  }

  const positions = rows.map((panel, index) => {
    const normalized = normalizeGridPos(panel?.gridPos);
    if (!normalized) {
      errors.push(`Panel ${index + 1}: gridPos must contain integer x, y, w, h within the 24-column grid.`);
    }
    return normalized;
  });

  for (let first = 0; first < positions.length; first += 1) {
    if (!positions[first]) continue;
    for (let second = first + 1; second < positions.length; second += 1) {
      if (positions[second] && overlaps(positions[first], positions[second])) {
        errors.push(`Panel ${first + 1} and Panel ${second + 1}: gridPos values overlap.`);
      }
    }
  }
  return errors;
}

function layoutPanels(panels) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return (Array.isArray(panels) ? panels : []).map((panel) => {
    const size = defaultPanelSize(panel);
    if (x + size.w > GRID_COLUMNS) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const gridPos = { ...size, x, y };
    x += size.w;
    rowHeight = Math.max(rowHeight, size.h);
    return gridPos;
  });
}

function resolveGridPositions(panels) {
  const positions = (Array.isArray(panels) ? panels : []).map((panel) => normalizeGridPos(panel?.gridPos));
  return positions.length > 0 && positions.every(Boolean) ? positions : layoutPanels(panels);
}

module.exports = {
  GRID_COLUMNS,
  defaultPanelSize,
  layoutPanels,
  normalizeGridPos,
  resolveGridPositions,
  validatePanelGridPositions
};
