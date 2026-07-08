const API_BASE_URL = (process.env.SHIPPING_INSPECTION_API_BASE_URL || "https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app").replace(/\/$/, "");

const timestampFields = new Set(["event_date", "last_counted_at", "updated_at"]);

const contracts = [
  {
    name: "KPIs",
    path: "/api/monitoring/grafana-cloud/kpis",
    fields: {
      metric: "string",
      value: "number",
      unit: "string?",
      status: "status"
    }
  },
  {
    name: "Backlog",
    path: "/api/monitoring/grafana-cloud/backlog",
    fields: {
      domain: "string",
      open_count: "number",
      open_quantity: "number"
    }
  },
  {
    name: "Events Daily",
    path: "/api/monitoring/grafana-cloud/events-daily",
    fields: {
      event_date: "timestamp",
      event_domain: "string",
      event_type: "string",
      event_count: "number"
    }
  },
  {
    name: "Inventory Count Variance",
    path: "/api/monitoring/grafana-cloud/inventory-count-variance",
    fields: {
      count_no: "string",
      count_name: "string",
      status: "string",
      variance_lines: "number",
      variance_quantity: "number",
      variance_quantity_abs: "number",
      last_counted_at: "timestamp"
    }
  },
  {
    name: "Operation Insights",
    path: "/api/monitoring/grafana-cloud/operation-insights",
    fields: {
      area: "string",
      risk: "status",
      score: "number",
      summary: "string",
      likely_cause: "string",
      recommended_action: "string"
    }
  },
  {
    name: "Alert Status",
    path: "/api/monitoring/grafana-cloud/alert-status",
    fields: {
      area: "string",
      status: "status",
      severity: "number",
      message: "string",
      owner: "string?",
      updated_at: "timestamp"
    }
  }
];

function isValidTimestamp(value) {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime());
}

function validateValue(value, expected) {
  const optional = expected.endsWith("?");
  const type = optional ? expected.slice(0, -1) : expected;
  if (value === undefined || value === null || value === "") {
    return optional;
  }
  if (type === "status") return typeof value === "string" && ["OK", "INFO", "WARN", "CRITICAL", "OPEN", "REVIEW", "CLOSED"].includes(value);
  if (type === "timestamp") return isValidTimestamp(value);
  return typeof value === type;
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE_URL}${path}`);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path}: response is not JSON`);
  }
  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${response.statusText}`);
  }
  return data;
}

async function validateContract(contract) {
  const data = await fetchJson(contract.path);
  const errors = [];
  if (!Array.isArray(data)) {
    return { name: contract.name, path: contract.path, count: 0, errors: ["response must be a JSON array"] };
  }
  if (data.length === 0) {
    errors.push("response array must include at least one row");
  }
  data.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`row ${index}: must be an object`);
      return;
    }
    for (const [field, expected] of Object.entries(contract.fields)) {
      if (!validateValue(row[field], expected)) {
        const label = timestampFields.has(field) ? "timestamp" : expected;
        errors.push(`row ${index}.${field}: expected ${label}, got ${JSON.stringify(row[field])}`);
      }
    }
  });
  return { name: contract.name, path: contract.path, count: data.length, errors };
}

async function main() {
  console.log(`Validating shipping inspection API: ${API_BASE_URL}`);
  const results = [];
  for (const contract of contracts) {
    try {
      results.push(await validateContract(contract));
    } catch (error) {
      results.push({ name: contract.name, path: contract.path, count: 0, errors: [error.message] });
    }
  }

  let failed = false;
  for (const result of results) {
    const ok = result.errors.length === 0;
    console.log(`${ok ? "OK" : "NG"} ${result.name} ${result.path} rows=${result.count}`);
    for (const error of result.errors) {
      failed = true;
      console.log(`  - ${error}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
