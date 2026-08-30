const { spawn } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const port = 46000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;

function waitForServer(child, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local server did not start in time.")), timeoutMs);
    const onData = (chunk) => {
      if (!String(chunk).includes("Grafana dashboard builder:")) return;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Local server exited before startup with code ${code}.`));
    });
  });
}

async function post(pathname, body) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const child = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_AUTH_MODE: "none",
      SERVICE_ROLE: "admin",
      VERTEX_AI_PROJECT: "",
      GOOGLE_CLOUD_PROJECT: "",
      GCLOUD_PROJECT: "",
      OPENAI_API_KEY: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  try {
    await waitForServer(child);

    const analyzed = await post("/api/analyze-company-sources", {
      keywords: ["金属加工", "NC旋盤", "プレス", "多品種少量"],
      notes: "設備保全と品質の営業デモを行う",
      aiConsent: true
    });
    assert(analyzed.status === 200, `Company analysis returned ${analyzed.status}.`);
    assert(analyzed.body.ok === true, "Company analysis response must be successful.");
    assert(analyzed.body.source === "fallback", "Local test without AI credentials must use fallback analysis.");
    assert(analyzed.body.analysis.dashboardType === "manufacturing", "Fallback must classify this case as manufacturing.");
    assert(Array.isArray(analyzed.body.analysis.confirmedFacts), "Analysis must separate confirmed facts.");
    assert(Array.isArray(analyzed.body.analysis.inferredFacts), "Analysis must separate inferred facts.");
    assert(Array.isArray(analyzed.body.analysis.missingInformation), "Analysis must list missing information.");

    const missingConsent = await post("/api/analyze-company-sources", { keywords: ["金属加工"] });
    assert(missingConsent.status === 400, "Missing AI consent must be rejected.");
    assert(missingConsent.body.code === "AI_CONSENT_REQUIRED", "Missing consent must return a stable error code.");

    const blockedUrl = await post("/api/analyze-company-sources", {
      url: "https://127.0.0.1/private",
      aiConsent: true
    });
    assert(blockedUrl.status === 400, `Private URL must return 400, received ${blockedUrl.status}.`);
    assert(blockedUrl.body.code === "BLOCKED_COMPANY_SOURCE_ADDRESS", "Private URL must be rejected by SSRF protection.");

    const proposed = await post("/api/propose", {
      industry: analyzed.body.analysis.companyName,
      dashboardType: analyzed.body.analysis.dashboardType,
      companyAnalysis: analyzed.body.analysis
    });
    assert(proposed.status === 200, `Contextual proposal returned ${proposed.status}.`);
    assert(Array.isArray(proposed.body.panels) && proposed.body.panels.length >= 1, "Contextual proposal must contain panels.");
    assert(proposed.body.source === "process-catalog", "Recognized company processes must use the stable process catalog.");
    assert(proposed.body.panels.some((panel) => panel.title === "Press Load Peak"), "Press analysis must produce a press-specific panel.");
    assert(proposed.body.panels.some((panel) => panel.title === "Spindle Load Torque"), "Machining analysis must produce a machining-specific panel.");

    const mismatch = await post("/api/propose", {
      industry: "Test company",
      dashboardType: "iot",
      companyAnalysis: analyzed.body.analysis
    });
    assert(mismatch.status === 400, "Mismatched analysis dashboard type must be rejected.");
    assert(mismatch.body.code === "INVALID_COMPANY_ANALYSIS", "Mismatched analysis must return a stable error code.");

    console.log("Company analysis API verification passed: consent, fallback, SSRF rejection, contextual proposal, and input contract.");
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve)).catch(() => {});
    if (stderr.trim()) process.stderr.write(stderr);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
