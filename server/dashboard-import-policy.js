function dashboardUid(payload) {
  const uid = payload?.dashboard?.uid || payload?.uid;
  if (typeof uid !== "string" || !uid.trim()) {
    throw new Error("Dashboard JSON must include dashboard.uid.");
  }
  return uid.trim();
}

function prepareDashboardImport(payload, { exists = false, overwrite = false } = {}) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Dashboard payload must be an object.");
  }
  const uid = dashboardUid(payload);
  if (exists && !overwrite) {
    throw new Error(`Dashboard ${uid} already exists. Set OVERWRITE_DASHBOARD=true to update it explicitly.`);
  }
  return {
    ...payload,
    overwrite: overwrite === true
  };
}

module.exports = { dashboardUid, prepareDashboardImport };
