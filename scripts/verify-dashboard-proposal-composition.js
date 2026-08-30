"use strict";

const assert = require("node:assert");
const { spawn } = require("node:child_process");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const port = 47000 + Math.floor(Math.random() * 1000);
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

async function propose(body) {
  const response = await fetch(`${origin}/api/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      dashboardType: "manufacturing",
      monitoringGoal: "maintenance",
      primaryProcess: "",
      selectedEquipment: [],
      ...body
    })
  });
  const result = await response.json();
  assert.strictEqual(response.status, 200, JSON.stringify(result));
  return result;
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
    const cases = [
      ["プレス加工業", "Press Load Peak"],
      ["熱処理業", "Furnace Zone Temperature"],
      ["めっき業", "Rectifier Current"],
      ["放電加工業", "Discharge Pulse Stability"],
      ["研磨加工業", "Grinding Spindle Current"],
      ["溶接業", "Welding Current"],
      ["切削加工業", "Spindle Load Torque"],
      ["板金曲げ加工業", "Bending Force"],
      ["レーザー加工業", "Laser Oscillator Output"]
    ];
    const firstTitles = [];
    for (const [industry, expectedFirst] of cases) {
      const proposal = await propose({ industry });
      assert.strictEqual(proposal.source, "process-catalog");
      assert.strictEqual(proposal.panels[0].title, expectedFirst, industry);
      assert.strictEqual(proposal.panels[0].proposalSource, "process-catalog");
      assert.strictEqual(proposal.panels[0].rangeSource, "testdata-demo-default");
      assert.ok(proposal.panels[0].rationale);
      assert.strictEqual(proposal.panels.filter((panel) => panel.proposalSource === "common-kpi").length, 4);
      assert.strictEqual(new Set(proposal.panels.map((panel) => panel.title.toLowerCase())).size, proposal.panels.length);
      firstTitles.push(proposal.panels[0].title);
    }
    assert.strictEqual(new Set(firstTitles).size, cases.length, "Each process must produce a distinct primary panel.");

    const production = await propose({ industry: "プレス加工業", monitoringGoal: "production" });
    assert.ok(production.panels.some((panel) => panel.title === "Overall Equipment Effectiveness"));
    assert.ok(!production.panels.some((panel) => panel.title === "MTBF / MTTR Trend"));

    const equipment = await propose({
      industry: "金属加工業",
      primaryProcess: "machining",
      selectedEquipment: ["CNC旋盤"]
    });
    assert.deepStrictEqual(equipment.matchedProcesses, ["machining"]);
    assert.ok(equipment.panels.filter((panel) => panel.proposalSource === "process-catalog")
      .every((panel) => panel.equipment.includes("CNC旋盤")));

    const invalidGoalResponse = await fetch(`${origin}/api/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ industry: "プレス加工", dashboardType: "manufacturing", monitoringGoal: "invalid" })
    });
    assert.strictEqual(invalidGoalResponse.status, 400);

    console.log("OK process-specific ordering, goal KPIs, equipment filtering, metadata, deduplication, and input validation.");
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
