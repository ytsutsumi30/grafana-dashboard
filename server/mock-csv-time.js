const RELATIVE_TIME_TOKEN = /__NOW(?:_MINUS_(\d+)([SMHD]))?__/g;
const FIXED_ISO_TIMESTAMP = /\b20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/;

const UNIT_MILLISECONDS = {
  S: 1000,
  M: 60 * 1000,
  H: 60 * 60 * 1000,
  D: 24 * 60 * 60 * 1000
};

function materializeRelativeTimeTokens(value, now = new Date()) {
  const anchor = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(anchor)) {
    throw new Error("A valid time anchor is required.");
  }
  return String(value || "").replace(RELATIVE_TIME_TOKEN, (_token, amount, unit) => {
    const offset = amount ? Number(amount) * UNIT_MILLISECONDS[unit] : 0;
    return new Date(anchor - offset).toISOString();
  });
}

function materializeDashboardRelativeTimes(payload, now = new Date()) {
  if (Array.isArray(payload)) {
    return payload.map((value) => materializeDashboardRelativeTimes(value, now));
  }
  if (payload && typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, materializeDashboardRelativeTimes(value, now)])
    );
  }
  return typeof payload === "string" ? materializeRelativeTimeTokens(payload, now) : payload;
}

function containsFixedIsoTimestamp(value) {
  return FIXED_ISO_TIMESTAMP.test(String(value || ""));
}

module.exports = {
  containsFixedIsoTimestamp,
  materializeDashboardRelativeTimes,
  materializeRelativeTimeTokens
};
