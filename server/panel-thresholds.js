const RISK_DIRECTIONS = new Set(["high", "low", "outside"]);

function normalizeRiskDirection(value) {
  return RISK_DIRECTIONS.has(value) ? value : "high";
}

function thresholdValues(min, max, unit, riskDirection = "high") {
  const direction = normalizeRiskDirection(riskDirection);
  const span = max - min;
  if (direction === "low") {
    return { warning: min + span * 0.6, critical: min + span * 0.4 };
  }
  if (direction === "outside") {
    return { warning: min + span * 0.25, critical: min + span * 0.75 };
  }
  if (unit === "celsius" || unit === "amp" || unit === "dB" || unit === "accMS2") {
    return { warning: min + span * 0.75, critical: min + span * 0.9 };
  }
  return { warning: min + span * 0.8, critical: max };
}

function thresholdOrderIsValid(riskDirection, warning, critical) {
  const direction = normalizeRiskDirection(riskDirection);
  return direction === "low" ? critical < warning : warning < critical;
}

function grafanaThresholdSteps(min, max, unit, warningThreshold, criticalThreshold, riskDirection = "high") {
  const direction = normalizeRiskDirection(riskDirection);
  const defaults = thresholdValues(min, max, unit, direction);
  const warning = Number.isFinite(Number(warningThreshold)) ? Number(warningThreshold) : defaults.warning;
  const critical = Number.isFinite(Number(criticalThreshold)) ? Number(criticalThreshold) : defaults.critical;
  if (direction === "low") {
    return [
      { color: "red", value: null },
      { color: "yellow", value: critical },
      { color: "green", value: warning }
    ];
  }
  if (direction === "outside") {
    return [
      { color: "red", value: null },
      { color: "green", value: warning },
      { color: "red", value: critical }
    ];
  }
  return [
    { color: "green", value: null },
    { color: "yellow", value: warning },
    { color: "red", value: critical }
  ];
}

module.exports = {
  RISK_DIRECTIONS,
  normalizeRiskDirection,
  thresholdValues,
  thresholdOrderIsValid,
  grafanaThresholdSteps
};
