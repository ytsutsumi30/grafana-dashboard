const fs = require("fs");
const path = require("path");
const { materializeDashboardRelativeTimes } = require("../server/mock-csv-time");
const { prepareDashboardImport } = require("../server/dashboard-import-policy");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/materialize-dashboard-json.js <dashboard-json> [anchor-iso]");
  process.exit(2);
}

const resolvedPath = path.resolve(inputPath);
const options = new Set(process.argv.slice(3));
const anchorArgument = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "";
const anchor = anchorArgument ? new Date(anchorArgument) : new Date();
const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
const materialized = materializeDashboardRelativeTimes(payload, anchor);
const prepared = options.has("--overwrite")
  ? prepareDashboardImport(materialized, { overwrite: true })
  : materialized;
process.stdout.write(JSON.stringify(prepared));
