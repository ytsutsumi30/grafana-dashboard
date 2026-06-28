const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const GRAFANA_URL = (process.env.GRAFANA_URL || "https://ytsutsumi30.grafana.net").replace(/\/$/, "");
const TOKEN = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || process.env.GRAFANA_CLOUD_TOKEN || "";
const AI_PROVIDER = (process.env.AI_PROVIDER || "vertex").toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const VERTEX_AI_PROJECT = process.env.VERTEX_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
const VERTEX_AI_LOCATION = process.env.VERTEX_AI_LOCATION || "global";
const VERTEX_AI_MODEL = process.env.VERTEX_AI_MODEL || "gemini-2.5-flash-lite";
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const VISUALIZATIONS = new Set(["timeseries", "stat", "gauge", "piechart", "table"]);

const manufacturingProfiles = [
  {
    match: ["板金", "sheet metal", "metal fabrication"],
    slug: "sheet-metal",
    focus: "板金加工業者",
    panels: [
      ["Cycle Time", "timeseries", "s", 18, 75, "加工1サイクルのばらつきと遅延を監視"],
      ["Press Brake Load", "timeseries", "short", 20, 120, "曲げ工程の負荷変動を監視"],
      ["Laser Cutter Power", "timeseries", "kwatt", 1, 8, "レーザー加工機の出力を監視"],
      ["Compressor Pressure", "gauge", "pressurebar", 0.5, 1.0, "エア圧低下を監視"],
      ["Ambient Temperature", "stat", "celsius", 10, 40, "作業場温度の最新値"],
      ["Ambient Humidity", "stat", "percent", 10, 70, "作業場湿度の最新値"],
      ["Motor Current", "timeseries", "amp", 20, 95, "搬送・加工設備の電流負荷を監視"],
      ["Vibration Acceleration", "timeseries", "accMS2", 0.01, 0.12, "機械振動の増加を監視"]
    ]
  },
  {
    match: ["プレス", "press"],
    slug: "press",
    focus: "プレス加工業者",
    panels: [
      ["Cycle Time", "timeseries", "s", 10, 15, "サイクルタイムのドリフトを監視"],
      ["Maximum Press Pressure", "timeseries", "short", 90, 110, "最大プレス圧力の異常を監視"],
      ["Die Temperature", "timeseries", "celsius", 10, 100, "金型温度の上昇を監視"],
      ["Ambient Temperature", "stat", "celsius", 10, 40, "周囲温度の最新値"],
      ["Ambient Humidity", "stat", "percent", 10, 70, "周囲湿度の最新値"],
      ["Vibration Acceleration", "timeseries", "accMS2", 0.01, 0.1, "軸受や締結ゆるみの兆候を監視"],
      ["Motor Current", "timeseries", "amp", 30, 80, "モーター電流負荷を監視"],
      ["Noise Level", "timeseries", "dB", 60, 80, "異音や衝撃音を監視"]
    ]
  },
  {
    match: ["表面処理", "めっき", "メッキ", "塗装", "surface treatment", "plating", "coating"],
    slug: "surface-treatment",
    focus: "表面処理業者",
    panels: [
      ["Bath Temperature", "timeseries", "celsius", 20, 75, "処理槽温度の安定性を監視"],
      ["Bath pH", "timeseries", "short", 2, 12, "薬液pHの逸脱を監視"],
      ["Line Speed", "timeseries", "velocityms", 0.05, 1.2, "搬送ライン速度を監視"],
      ["Rectifier Current", "timeseries", "amp", 100, 2500, "整流器の電流負荷を監視"],
      ["Rinse Water Conductivity", "timeseries", "short", 5, 500, "洗浄水の導電率を監視"],
      ["Ambient Temperature", "stat", "celsius", 10, 40, "作業場温度の最新値"],
      ["Ambient Humidity", "stat", "percent", 20, 85, "作業場湿度の最新値"],
      ["Exhaust Fan Load", "gauge", "percent", 20, 100, "排気設備の負荷を監視"]
    ]
  },
  {
    match: ["半導体", "semiconductor", "クリーンルーム"],
    slug: "semiconductor",
    focus: "半導体関連製造業者",
    panels: [
      ["Cleanroom Temperature", "timeseries", "celsius", 20, 25, "クリーンルーム温度の安定性を監視"],
      ["Cleanroom Humidity", "timeseries", "percent", 35, 55, "クリーンルーム湿度の安定性を監視"],
      ["Particle Count", "timeseries", "short", 0, 1200, "パーティクル数の増加を監視"],
      ["Tool Utilization", "gauge", "percent", 40, 98, "製造装置の稼働率を監視"],
      ["Vacuum Pressure", "timeseries", "pressurembar", 0.001, 10, "真空圧の異常を監視"],
      ["Chiller Temperature", "timeseries", "celsius", 5, 25, "チラー温度を監視"],
      ["Motor Current", "timeseries", "amp", 5, 60, "搬送・補機の電流負荷を監視"],
      ["Alarm Count", "stat", "short", 0, 20, "現在のアラーム件数を確認"]
    ]
  },
  {
    match: ["自動車", "車載", "automotive", "auto parts"],
    slug: "automotive",
    focus: "自動車部品製造業者",
    panels: [
      ["Line Throughput", "timeseries", "ops", 100, 1200, "ライン処理数を監視"],
      ["Cycle Time", "timeseries", "s", 8, 45, "工程サイクルのばらつきを監視"],
      ["Robot Servo Load", "timeseries", "percent", 10, 95, "ロボットサーボ負荷を監視"],
      ["Welding Current", "timeseries", "amp", 500, 8000, "溶接電流の安定性を監視"],
      ["Torque Result", "timeseries", "short", 5, 120, "締付トルクのばらつきを監視"],
      ["Ambient Temperature", "stat", "celsius", 10, 40, "作業場温度の最新値"],
      ["Reject Rate", "gauge", "percent", 0, 5, "不良率の最新状態を監視"],
      ["Andon Alert Count", "stat", "short", 0, 12, "現在のアンドン呼び出し件数を確認"]
    ]
  },
  {
    match: ["化学", "chemical"],
    slug: "chemical",
    focus: "化学製造業者",
    panels: [
      ["Reactor Temperature", "timeseries", "celsius", 20, 180, "反応槽温度の推移を監視"],
      ["Reactor Pressure", "timeseries", "pressurebar", 0, 12, "反応槽圧力の異常を監視"],
      ["Agitator Current", "timeseries", "amp", 10, 150, "撹拌機の電流負荷を監視"],
      ["Flow Rate", "timeseries", "flowlpm", 5, 800, "流量の変動を監視"],
      ["Tank Level", "gauge", "percent", 0, 100, "タンク液位を監視"],
      ["Ambient Temperature", "stat", "celsius", 10, 40, "設備周辺温度の最新値"],
      ["Exhaust Fan Load", "timeseries", "percent", 20, 100, "排気設備負荷を監視"],
      ["Alarm Count", "stat", "short", 0, 20, "現在のアラーム件数を確認"]
    ]
  },
  {
    match: ["医薬", "製薬", "pharmaceutical", "pharma"],
    slug: "pharmaceutical",
    focus: "医薬品製造業者",
    panels: [
      ["Room Temperature", "timeseries", "celsius", 18, 28, "管理区域の温度を監視"],
      ["Room Humidity", "timeseries", "percent", 35, 65, "管理区域の湿度を監視"],
      ["Differential Pressure", "timeseries", "pressurepa", 0, 80, "室間差圧を監視"],
      ["Filling Weight", "timeseries", "massg", 90, 110, "充填重量のばらつきを監視"],
      ["Line Speed", "timeseries", "ops", 50, 900, "包装・充填ライン速度を監視"],
      ["Particle Count", "timeseries", "short", 0, 800, "清浄度の変化を監視"],
      ["Reject Rate", "gauge", "percent", 0, 3, "不良率の最新状態を監視"],
      ["Batch Alarm Count", "stat", "short", 0, 10, "現在バッチのアラーム件数を確認"]
    ]
  },
  {
    match: ["成形", "射出", "樹脂", "molding", "injection"],
    slug: "injection-molding",
    focus: "射出成形業者",
    panels: [
      ["Cycle Time", "timeseries", "s", 20, 65, "成形サイクルのばらつきを監視"],
      ["Injection Pressure", "timeseries", "pressurebar", 400, 1800, "射出圧の異常を監視"],
      ["Mold Temperature", "timeseries", "celsius", 20, 120, "金型温度の安定性を監視"],
      ["Barrel Temperature", "timeseries", "celsius", 160, 280, "シリンダ温度を監視"],
      ["Ambient Temperature", "stat", "celsius", 10, 40, "周囲温度の最新値"],
      ["Ambient Humidity", "stat", "percent", 10, 70, "周囲湿度の最新値"],
      ["Motor Current", "timeseries", "amp", 30, 120, "油圧・サーボ負荷を監視"],
      ["Reject Rate", "gauge", "percent", 0, 8, "不良率の最新状態を監視"]
    ]
  },
  {
    match: ["食品", "food"],
    slug: "food-processing",
    focus: "食品加工業者",
    panels: [
      ["Line Throughput", "timeseries", "ops", 200, 1400, "ライン処理数を監視"],
      ["Filling Weight", "timeseries", "massg", 90, 110, "充填重量のばらつきを監視"],
      ["Refrigeration Temperature", "timeseries", "celsius", -5, 10, "冷却温度を監視"],
      ["Conveyor Speed", "timeseries", "velocityms", 0.2, 1.5, "搬送速度を監視"],
      ["Ambient Temperature", "stat", "celsius", 5, 35, "作業場温度の最新値"],
      ["Ambient Humidity", "stat", "percent", 20, 80, "作業場湿度の最新値"],
      ["Motor Current", "timeseries", "amp", 5, 50, "搬送モーター負荷を監視"],
      ["Packaging Error Rate", "gauge", "percent", 0, 5, "包装エラー率を監視"]
    ]
  }
];

const iotProfiles = [
  {
    match: ["電力", "power", "energy", "co2", "太陽光", "発電"],
    slug: "power-monitoring",
    focus: "電力監視IoTデバイス",
    time: { from: "now-30d", to: "now" },
    panels: [
      {
        title: "Current Power Usage",
        visualization: "stat",
        unit: "kwatt",
        min: 50,
        max: 500,
        purpose: "現在の総消費電力を監視",
        latestOnly: true
      },
      {
        title: "Solar / Generated Power",
        visualization: "gauge",
        unit: "kwatt",
        min: 0,
        max: 120,
        purpose: "現在の発電量を監視",
        latestOnly: true
      },
      {
        title: "CO2 Emissions",
        visualization: "stat",
        unit: "short",
        min: 100,
        max: 1200,
        purpose: "現在または日次換算のCO2排出量を監視",
        latestOnly: true
      },
      {
        title: "Daily Power Trend",
        visualization: "timeseries",
        unit: "kwatth",
        min: 0,
        max: 2500,
        purpose: "日別の電力使用量、発電量、CO2排出量を比較",
        scenarioId: "csv_content",
        csvContent: "time,power_usage_kwh,generated_kwh,co2_kg\n2026-05-16T00:00:00+09:00,2240,205,1030\n2026-05-17T00:00:00+09:00,1910,164,879\n2026-05-18T00:00:00+09:00,780,72,359\n2026-05-19T00:00:00+09:00,420,38,193\n2026-05-20T00:00:00+09:00,350,31,161\n2026-05-21T00:00:00+09:00,1830,145,842\n2026-05-22T00:00:00+09:00,2050,188,943\n2026-05-23T00:00:00+09:00,2110,201,971\n2026-05-24T00:00:00+09:00,1880,160,865\n2026-05-25T00:00:00+09:00,710,62,327\n2026-05-26T00:00:00+09:00,390,35,179\n2026-05-27T00:00:00+09:00,1360,118,626\n2026-05-28T00:00:00+09:00,1980,212,911\n2026-05-29T00:00:00+09:00,2070,226,952\n2026-05-30T00:00:00+09:00,2085,231,959\n2026-05-31T00:00:00+09:00,1810,172,833\n2026-06-01T00:00:00+09:00,1010,90,465\n2026-06-02T00:00:00+09:00,660,56,304\n2026-06-03T00:00:00+09:00,2460,252,1132\n2026-06-04T00:00:00+09:00,1950,178,897\n2026-06-05T00:00:00+09:00,2130,194,980\n2026-06-06T00:00:00+09:00,1800,151,828\n2026-06-07T00:00:00+09:00,2040,187,938\n2026-06-08T00:00:00+09:00,1370,122,630\n2026-06-09T00:00:00+09:00,1710,148,787\n2026-06-10T00:00:00+09:00,1990,174,915\n2026-06-11T00:00:00+09:00,2180,192,1003\n2026-06-12T00:00:00+09:00,2320,215,1067\n2026-06-13T00:00:00+09:00,1850,168,851\n2026-06-14T00:00:00+09:00,1420,136,653"
      },
      {
        title: "Power Distribution by Category",
        visualization: "piechart",
        unit: "kwatth",
        min: 0,
        max: 20000,
        purpose: "設備カテゴリ別の電力使用量構成比を確認",
        scenarioId: "csv_content",
        csvContent: "category,kwh\nMachining Center,19477.17\nMolding Machine,13863.64\nAir Conditioning,6646.12\n2F Main Feeder,2915.91\nLighting,419.50\nVending Machine,190.83\nCompressor,108.53\n2F Lighting Warehouse,88.86\n2F Lighting Corridor,42.53\nElevator,6.44"
      },
      {
        title: "Device Communication Status",
        visualization: "table",
        unit: "short",
        min: 0,
        max: 1,
        purpose: "IoTデバイスの通信状態を確認",
        scenarioId: "csv_content",
        csvContent: "device,area,status,last_seen,message\nPM-001,Machining Center,ONLINE,2026-06-14T09:31:12+09:00,collecting normally\nPM-002,Molding Machine,ONLINE,2026-06-14T09:31:08+09:00,collecting normally\nPM-003,Air Conditioning,WARN,2026-06-14T09:28:44+09:00,delayed heartbeat\nPM-004,2F Main Feeder,ONLINE,2026-06-14T09:31:02+09:00,collecting normally\nPM-005,Lighting,ONLINE,2026-06-14T09:30:58+09:00,collecting normally\nPM-006,Compressor,WARN,2026-06-14T09:27:31+09:00,packet loss detected\nPM-007,Elevator,OFFLINE,2026-06-14T09:12:10+09:00,no data for 19 minutes"
      }
    ]
  },
  {
    match: ["物流", "倉庫", "warehouse", "logistics", "cold chain"],
    slug: "logistics-warehouse",
    focus: "物流倉庫IoT",
    panels: [
      ["Gateway Online Rate", "stat", "percent", 80, 100, "IoTゲートウェイのオンライン率を確認"],
      ["Temperature Sensor Trend", "timeseries", "celsius", 0, 35, "保管エリア温度の推移を監視"],
      ["Humidity Sensor Trend", "timeseries", "percent", 20, 85, "保管エリア湿度の推移を監視"],
      ["Door Open Count", "timeseries", "short", 0, 120, "搬入口や冷蔵庫扉の開閉回数を監視"],
      ["Battery Level", "gauge", "percent", 0, 100, "無線センサーの電池残量を監視"],
      {
        title: "Device Communication Status",
        visualization: "table",
        unit: "short",
        min: 0,
        max: 1,
        purpose: "倉庫IoTデバイスの通信状態を確認",
        scenarioId: "csv_content",
        csvContent: "device,area,status,last_seen,message\nGW-001,Receiving,ONLINE,2026-06-14T09:31:12+09:00,collecting normally\nTEMP-014,Cold Storage,WARN,2026-06-14T09:27:44+09:00,delayed heartbeat\nDOOR-003,Shipping,ONLINE,2026-06-14T09:30:58+09:00,collecting normally\nBATT-021,Rack A,OFFLINE,2026-06-14T09:10:10+09:00,no data for 20 minutes"
      },
      {
        title: "Area Occupancy",
        visualization: "piechart",
        unit: "percent",
        min: 0,
        max: 100,
        purpose: "エリア別の滞留・利用状況を確認",
        scenarioId: "csv_content",
        csvContent: "area,percent\nReceiving,22\nStorage A,34\nStorage B,18\nCold Storage,11\nShipping,15"
      }
    ]
  }
];

const defaultProfile = {
  slug: "manufacturing",
  focus: "製造業",
  panels: [
    ["Cycle Time", "timeseries", "s", 10, 60, "工程サイクルのばらつきを監視"],
    ["Equipment Load", "timeseries", "percent", 20, 95, "設備負荷の推移を監視"],
    ["Process Temperature", "timeseries", "celsius", 10, 100, "工程温度の推移を監視"],
    ["Ambient Temperature", "stat", "celsius", 10, 40, "周囲温度の最新値"],
    ["Ambient Humidity", "stat", "percent", 10, 70, "周囲湿度の最新値"],
    ["Vibration Acceleration", "timeseries", "accMS2", 0.01, 0.1, "振動増加を監視"],
    ["Motor Current", "timeseries", "amp", 30, 80, "モーター電流負荷を監視"],
    ["Noise Level", "timeseries", "dB", 60, 85, "騒音レベルを監視"]
  ]
};

function findMatchingProfile(industry, dashboardType) {
  const key = String(industry || "").trim().toLowerCase();
  const profiles = dashboardType === "iot" ? iotProfiles : manufacturingProfiles;
  return profiles.find((profile) => profile.match.some((term) => key.includes(term.toLowerCase()))) || null;
}

function fallbackProfile(dashboardType) {
  return dashboardType === "iot" ? iotProfiles[0] : defaultProfile;
}

function pickProfile(industry, dashboardType) {
  return findMatchingProfile(industry, dashboardType) || fallbackProfile(dashboardType);
}

function slugifyIndustry(industry, profile) {
  const text = String(industry || "").trim().toLowerCase();
  const ascii = text
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (ascii && ascii !== "iot") return ascii;

  const japaneseSlugHints = [
    [["半導体"], "semiconductor"],
    [["表面処理", "めっき", "メッキ"], "surface-treatment"],
    [["物流", "倉庫"], "logistics-warehouse"],
    [["自動車", "車載"], "automotive"],
    [["電子部品", "基板", "pcb"], "electronic-components"],
    [["金属加工"], "metal-processing"],
    [["化学"], "chemical"],
    [["医薬", "製薬"], "pharmaceutical"],
    [["繊維"], "textile"],
    [["包装", "パッケージ"], "packaging"]
  ];
  const original = String(industry || "");
  const match = japaneseSlugHints.find(([terms]) => terms.some((term) => original.includes(term)));
  return match ? match[1] : profile.slug;
}

function panelFromTuple(tuple, index) {
  if (!Array.isArray(tuple)) {
    return { id: index + 1, ...tuple };
  }
  const [title, visualization, unit, min, max, purpose] = tuple;
  return {
    id: index + 1,
    title,
    visualization,
    unit,
    min,
    max,
    purpose,
    latestOnly: visualization === "stat" || visualization === "gauge"
  };
}

function resolveDashboardType(industry, dashboardType) {
  if (dashboardType === "iot" || dashboardType === "manufacturing") return dashboardType;
  const key = String(industry || "").toLowerCase();
  return key.includes("iot") || key.includes("デバイス") || key.includes("電力") ? "iot" : "manufacturing";
}

function createProposalFromProfile(industry, dashboardType, profile, source = "template") {
  const resolvedType = resolveDashboardType(industry, dashboardType);
  const slugBase = slugifyIndustry(industry, profile);
  const suffix = resolvedType === "iot" ? "iot-monitoring-demo" : "maintenance-demo";
  const slugSuffix = resolvedType === "iot" ? "iot-monitoring-demo" : "machine-maintenance-demo";
  return {
    industry: String(industry || profile.focus).trim() || profile.focus,
    dashboardType: resolvedType,
    source,
    slugBase,
    dashboardUid: `${slugBase}-${suffix}`,
    dashboardSlug: `${slugBase}-${slugSuffix}`,
    dashboardTitle: `${slugBase} ${slugSuffix.replace(/-/g, " ")}`,
    time: profile.time || { from: "now-6h", to: "now" },
    panels: profile.panels.map(panelFromTuple)
  };
}

function proposePanels(industry, dashboardType) {
  const resolvedType = resolveDashboardType(industry, dashboardType);
  return createProposalFromProfile(industry, resolvedType, pickProfile(industry, resolvedType));
}

function knownProposal(industry, dashboardType) {
  const resolvedType = resolveDashboardType(industry, dashboardType);
  const profile = findMatchingProfile(industry, resolvedType);
  return profile ? createProposalFromProfile(industry, resolvedType, profile, "template") : null;
}

function normalizePanel(panel, index) {
  const min = Number(panel.min);
  const max = Number(panel.max);
  const visualization = VISUALIZATIONS.has(panel.visualization) ? panel.visualization : "timeseries";
  const normalizedMin = Number.isFinite(min) ? min : 0;
  const normalizedMax = Number.isFinite(max) && max > normalizedMin ? max : normalizedMin + 100;
  return {
    id: index + 1,
    title: String(panel.title || `Sensor Panel ${index + 1}`).slice(0, 80),
    visualization,
    unit: String(panel.unit || "short").slice(0, 32),
    min: normalizedMin,
    max: normalizedMax,
    purpose: String(panel.purpose || "監視対象の状態を確認").slice(0, 160),
    latestOnly: visualization === "stat" || visualization === "gauge" || panel.latestOnly === true,
    scenarioId: panel.scenarioId === "csv_content" ? "csv_content" : "random_walk",
    csvContent: panel.scenarioId === "csv_content" ? String(panel.csvContent || "").slice(0, 4000) : ""
  };
}

function validateAiProposal(raw, industry, dashboardType) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.panels)) {
    throw new Error("AI proposal response did not include panels.");
  }
  const resolvedType = resolveDashboardType(industry, dashboardType);
  const profile = fallbackProfile(resolvedType);
  const base = createProposalFromProfile(industry, resolvedType, profile, "ai");
  const panelCount = Math.min(Math.max(raw.panels.length, 5), 10);
  const panels = raw.panels.slice(0, panelCount).map(normalizePanel);
  if (panels.length < 5) {
    throw new Error("AI proposal response returned too few panels.");
  }
  return {
    ...base,
    source: "ai",
    panels
  };
}

function extractResponseText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("");
}

function aiProposalSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["panels"],
    properties: {
      panels: {
        type: "array",
        minItems: 5,
        maxItems: 10,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "visualization", "unit", "min", "max", "purpose", "latestOnly", "scenarioId", "csvContent"],
          properties: {
            title: { type: "string" },
            visualization: { type: "string", enum: ["timeseries", "stat", "gauge", "piechart", "table"] },
            unit: { type: "string" },
            min: { type: "number" },
            max: { type: "number" },
            purpose: { type: "string" },
            latestOnly: { type: "boolean" },
            scenarioId: { type: "string", enum: ["random_walk", "csv_content"] },
            csvContent: { type: "string" }
          }
        }
      }
    }
  };
}

function proposalPrompt(industry, dashboardType) {
  const resolvedType = resolveDashboardType(industry, dashboardType);
  return `業種または監視対象: ${industry}
ダッシュボード種別: ${resolvedType}
TestData datasourceでモックできる、営業デモ向けの実用的なGrafanaパネル案を5-10個作成してください。
各パネルは編集可能な案として短く具体的にしてください。
Grafana-compatible units only: s, celsius, percent, amp, dB, accMS2, kwatt, kwatth, short, pressurebar, ops.
Prefer random_walk mock data. Use csv_content only when piechart or table needs fixed demo rows.
Return JSON only.`;
}

async function getGoogleAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;

  const response = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } }
  );
  if (!response.ok) {
    throw new Error(`Could not get Google access token from metadata server: ${response.status}`);
  }
  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Metadata server response did not include access_token.");
  }
  return data.access_token;
}

function extractVertexText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((part) => part.text || "").join("");
}

async function proposePanelsWithVertex(industry, dashboardType) {
  if (!VERTEX_AI_PROJECT) {
    throw new Error("VERTEX_AI_PROJECT or GOOGLE_CLOUD_PROJECT is not set.");
  }

  const token = await getGoogleAccessToken();
  const host = VERTEX_AI_LOCATION === "global" ? "aiplatform.googleapis.com" : `${VERTEX_AI_LOCATION}-aiplatform.googleapis.com`;
  const endpoint = `https://${host}/v1/projects/${encodeURIComponent(VERTEX_AI_PROJECT)}/locations/${encodeURIComponent(VERTEX_AI_LOCATION)}/publishers/google/models/${encodeURIComponent(VERTEX_AI_MODEL)}:generateContent`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text:
              "You design practical Grafana dashboard panel proposals for Japanese sales engineers visiting manufacturing and IoT customers. Return only JSON matching the response schema."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: proposalPrompt(industry, dashboardType) }]
        }
      ],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "application/json",
        responseSchema: aiProposalSchema()
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Vertex AI returned ${response.status}`);
  }

  const text = extractVertexText(data);
  if (!text) {
    throw new Error("Vertex AI response did not include JSON text.");
  }
  return validateAiProposal(JSON.parse(text), industry, dashboardType);
}

async function proposePanelsWithAi(industry, dashboardType) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const resolvedType = resolveDashboardType(industry, dashboardType);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "system",
          content:
            "You design practical Grafana dashboard panel proposals for Japanese sales engineers visiting manufacturing and IoT customers. Return only data matching the JSON schema. Use Grafana-compatible units such as s, celsius, percent, amp, dB, accMS2, kwatt, kwatth, short, pressurebar, ops. Prefer random_walk mock data unless piechart/table needs csv_content."
        },
        {
          role: "user",
          content: proposalPrompt(industry, resolvedType)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "grafana_dashboard_panel_proposal",
          strict: true,
          schema: aiProposalSchema()
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API returned ${response.status}`);
  }

  const text = extractResponseText(data);
  if (!text) {
    throw new Error("OpenAI API response did not include JSON text.");
  }
  return validateAiProposal(JSON.parse(text), industry, resolvedType);
}

async function hybridProposal(industry, dashboardType) {
  const template = knownProposal(industry, dashboardType);
  if (template) return template;

  try {
    return AI_PROVIDER === "openai" ? await proposePanelsWithAi(industry, dashboardType) : await proposePanelsWithVertex(industry, dashboardType);
  } catch (error) {
    const fallback = proposePanels(industry, dashboardType);
    return {
      ...fallback,
      source: "fallback",
      warning: `AI proposal failed: ${error.message}`
    };
  }
}

function layoutPanels(panels) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;

  return panels.map((panel) => {
    const isSmall = panel.visualization === "stat" || panel.visualization === "gauge";
    const isWide = panel.visualization === "timeseries" && String(panel.title).toLowerCase().includes("trend");
    const size = isWide ? { w: 24, h: 9 } : isSmall ? { w: 8, h: 5 } : { w: 12, h: 8 };
    if (x + size.w > 24) {
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

function thresholds(min, max, unit) {
  const span = max - min;
  if (unit === "celsius" || unit === "amp" || unit === "dB" || unit === "accMS2") {
    return [
      { color: "green", value: null },
      { color: "yellow", value: min + span * 0.75 },
      { color: "red", value: min + span * 0.9 }
    ];
  }
  return [
    { color: "green", value: null },
    { color: "yellow", value: min + span * 0.8 },
    { color: "red", value: max }
  ];
}

function grafanaPanel(panel, index, gridPos) {
  const type =
    panel.visualization === "gauge"
      ? "gauge"
      : panel.visualization === "stat"
        ? "stat"
        : panel.visualization === "piechart"
          ? "piechart"
          : panel.visualization === "table"
            ? "table"
            : "timeseries";
  const target = {
    refId: "A",
    datasource: { type: "grafana-testdata-datasource", uid: "testdata" },
    scenarioId: panel.scenarioId || "random_walk",
    alias: panel.title,
    seriesCount: 1,
    min: Number(panel.min),
    max: Number(panel.max)
  };
  if (panel.csvContent) {
    target.csvContent = panel.csvContent;
  }
  const base = {
    id: index + 1,
    type,
    title: panel.title,
    description: `${panel.purpose || ""} Mock range: ${panel.min}-${panel.max} ${panel.unit}.`.trim(),
    datasource: { type: "grafana-testdata-datasource", uid: "testdata" },
    gridPos,
    targets: [target],
    fieldConfig: {
      defaults: {
        unit: panel.unit || "short",
        min: Number(panel.min),
        max: Number(panel.max),
        decimals: Number(panel.max) <= 1 ? 3 : 1,
        thresholds: { mode: "absolute", steps: thresholds(Number(panel.min), Number(panel.max), panel.unit) }
      },
      overrides: []
    }
  };

  if (type === "timeseries") {
    base.fieldConfig.defaults.custom = {
      drawStyle: "line",
      lineInterpolation: "smooth",
      lineWidth: 2,
      fillOpacity: 14,
      showPoints: "never"
    };
    base.options = {
      legend: { displayMode: "table", placement: "bottom", calcs: ["lastNotNull", "mean", "max"] },
      tooltip: { mode: "single", sort: "none" }
    };
    return base;
  }

  if (type === "piechart") {
    base.options = {
      pieType: "donut",
      displayLabels: ["name", "value", "percent"],
      legend: { displayMode: "table", placement: "bottom", showLegend: true, values: ["value", "percent"] },
      reduceOptions: { values: true, calcs: ["lastNotNull"], fields: "" }
    };
    return base;
  }

  if (type === "table") {
    base.fieldConfig = {
      defaults: { custom: { align: "auto", cellOptions: { type: "auto" } } },
      overrides: [
        {
          matcher: { id: "byName", options: "status" },
          properties: [
            { id: "custom.cellOptions", value: { type: "color-text" } },
            {
              id: "mappings",
              value: [
                {
                  type: "value",
                  options: {
                    ONLINE: { color: "green", index: 0 },
                    WARN: { color: "yellow", index: 1 },
                    OFFLINE: { color: "red", index: 2 }
                  }
                }
              ]
            }
          ]
        }
      ]
    };
    base.options = { showHeader: true, cellHeight: "sm", footer: { show: false } };
    return base;
  }

  if (type === "gauge") {
    base.options = {
      reduceOptions: { values: false, calcs: ["lastNotNull"], fields: "" },
      orientation: "auto",
      showThresholdLabels: false,
      showThresholdMarkers: true
    };
    return base;
  }

  base.options = {
    reduceOptions: { values: false, calcs: ["lastNotNull"], fields: "" },
    orientation: "horizontal",
    textMode: "auto",
    colorMode: "background",
    graphMode: "none",
    justifyMode: "center"
  };
  return base;
}

function buildDashboard(industry, panels, dashboardType) {
  const proposed = proposePanels(industry, dashboardType);
  const cleanPanels = Array.isArray(panels) && panels.length ? panels : proposed.panels;
  const gridPositions = layoutPanels(cleanPanels);
  return {
    id: null,
    uid: proposed.dashboardUid,
    title: proposed.dashboardTitle,
    tags: ["codex", "sales-demo", "manufacturing", "iot", "maintenance"],
    timezone: "browser",
    schemaVersion: 41,
    version: 1,
    refresh: "5s",
    time: proposed.time,
    panels: cleanPanels.map((panel, index) => grafanaPanel(panel, index, gridPositions[index]))
  };
}

function dashboardExists(uid) {
  return grafana(`/api/dashboards/uid/${encodeURIComponent(uid)}`)
    .then(() => true)
    .catch((error) => {
      if (String(error.message).startsWith("404")) return false;
      throw error;
    });
}

async function resolveDashboardIdentity(proposed, overwrite) {
  if (overwrite || !(await dashboardExists(proposed.dashboardUid))) {
    return {
      uid: proposed.dashboardUid,
      slug: proposed.dashboardSlug,
      suffix: ""
    };
  }

  for (let index = 1; index < 1000; index += 1) {
    const uid = `${proposed.dashboardUid}_${index}`;
    if (!(await dashboardExists(uid))) {
      return {
        uid,
        slug: `${proposed.dashboardSlug}_${index}`,
        suffix: `_${index}`
      };
    }
  }

  throw new Error(`No available dashboard UID found for ${proposed.dashboardUid}.`);
}

async function grafana(pathname, options = {}) {
  if (!TOKEN) {
    throw new Error("GRAFANA_SERVICE_ACCOUNT_TOKEN or GRAFANA_CLOUD_TOKEN is not set.");
  }
  const response = await fetch(`${GRAFANA_URL}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${data.message || text}`);
  }
  return data;
}

async function ensureTestData() {
  try {
    return await grafana("/api/datasources/uid/testdata");
  } catch (error) {
    if (!String(error.message).startsWith("404")) throw error;
    return grafana("/api/datasources", {
      method: "POST",
      body: JSON.stringify({
        name: "TestData",
        uid: "testdata",
        type: "grafana-testdata-datasource",
        access: "proxy",
        isDefault: false,
        jsonData: {}
      })
    });
  }
}

async function listFolders() {
  const folders = await grafana("/api/folders?limit=1000");
  return [
    { uid: "", title: "General / ルート", id: 0 },
    ...folders
      .map((folder) => ({ uid: folder.uid || "", title: folder.title || folder.uid || "Untitled", id: folder.id || 0 }))
      .sort((a, b) => a.title.localeCompare(b.title, "ja"))
  ];
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function handleApi(req, res) {
  try {
    if (req.method === "GET" && req.url === "/api/health") {
      const health = await grafana("/api/health");
      sendJson(res, 200, { ok: true, grafana: health, grafanaUrl: GRAFANA_URL });
      return;
    }

    if (req.method === "GET" && req.url === "/api/folders") {
      sendJson(res, 200, { ok: true, folders: await listFolders() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/propose") {
      const body = await readBody(req);
      sendJson(res, 200, await hybridProposal(body.industry, body.dashboardType));
      return;
    }

    if (req.method === "POST" && req.url === "/api/create-dashboard") {
      const body = await readBody(req);
      const proposed = proposePanels(body.industry, body.dashboardType);
      const overwrite = body.overwrite === true;
      const identity = await resolveDashboardIdentity(proposed, overwrite);
      const dashboard = buildDashboard(body.industry, body.panels, body.dashboardType);
      dashboard.uid = identity.uid;
      dashboard.title = identity.suffix ? `${dashboard.title} ${identity.suffix}` : dashboard.title;
      await ensureTestData();
      const folderUid = typeof body.folderUid === "string" ? body.folderUid : "";
      const result = await grafana("/api/dashboards/db", {
        method: "POST",
        body: JSON.stringify({
          dashboard,
          folderUid,
          message: `Create ${proposed.industry} maintenance dashboard from sales UI`,
          overwrite
        })
      });
      const url = result.url ? `${GRAFANA_URL}${result.url}` : `${GRAFANA_URL}/d/${identity.uid}/${identity.slug}`;
      sendJson(res, 200, {
        ok: true,
        name: identity.uid,
        title: dashboard.title,
        overwritten: overwrite && identity.uid === proposed.dashboardUid,
        url,
        result
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/grafana-sales-dashboard-builder.html" : decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const type = ext === ".html" ? "text/html; charset=utf-8" : ext === ".css" ? "text/css" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

http
  .createServer((req, res) => {
    if (req.url.startsWith("/api/")) {
      handleApi(req, res);
      return;
    }
    serveStatic(req, res);
  })
  .listen(PORT, HOST, () => {
    console.log(`Grafana dashboard builder: http://localhost:${PORT}`);
    console.log(`Listening on: http://${HOST}:${PORT}`);
    console.log(`Grafana Cloud URL: ${GRAFANA_URL}`);
  });
