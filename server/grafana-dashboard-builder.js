const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const GRAFANA_URL = (process.env.GRAFANA_URL || "https://ytsutsumi30.grafana.net").replace(/\/$/, "");
const TOKEN = process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN || process.env.GRAFANA_CLOUD_TOKEN || "";
const APP_ACCESS_TOKEN = process.env.APP_ACCESS_TOKEN || process.env.DASHBOARD_BUILDER_ACCESS_TOKEN || "";
const RATE_LIMIT_WINDOW_MS = Number(process.env.APP_RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.APP_RATE_LIMIT_MAX_REQUESTS || 30);
const AI_PROVIDER = (process.env.AI_PROVIDER || "vertex").toLowerCase();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const VERTEX_AI_PROJECT = process.env.VERTEX_AI_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "";
const VERTEX_AI_LOCATION = process.env.VERTEX_AI_LOCATION || "global";
const VERTEX_AI_MODEL = process.env.VERTEX_AI_MODEL || "gemini-2.5-flash-lite";
const FIRESTORE_HISTORY_ENABLED = String(process.env.FIRESTORE_HISTORY_ENABLED || "false").toLowerCase() === "true";
const FIRESTORE_PROJECT = process.env.FIRESTORE_PROJECT || VERTEX_AI_PROJECT;
const FIRESTORE_DATABASE = process.env.FIRESTORE_DATABASE || "(default)";
const FIRESTORE_HISTORY_COLLECTION = process.env.FIRESTORE_HISTORY_COLLECTION || "dashboard_creation_history";
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const VISUALIZATIONS = new Set(["timeseries", "stat", "gauge", "piechart", "table"]);
const MOBILE_SENSOR_MAX_POINTS = Number(process.env.MOBILE_SENSOR_MAX_POINTS || 5000);
const AI_ANALYSIS_CACHE_TTL_MS = Number(process.env.AI_ANALYSIS_CACHE_TTL_MS || 60000);
const APP_LOG_MAX_EVENTS = Number(process.env.APP_LOG_MAX_EVENTS || 500);
const mobileSensorState = {
  points: [],
  devices: new Map(),
  aiAnalysisCache: new Map()
};
const appLogState = {
  events: [],
  aiLogCache: new Map()
};
const rateLimitState = new Map();

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
    return normalizePanel({ id: index + 1, ...tuple }, index);
  }
  const [title, visualization, unit, min, max, purpose] = tuple;
  return normalizePanel({
    id: index + 1,
    title,
    visualization,
    unit,
    min,
    max,
    purpose,
    latestOnly: visualization === "stat" || visualization === "gauge"
  }, index);
}

function resolveDashboardType(industry, dashboardType) {
  if (dashboardType === "iot" || dashboardType === "manufacturing") return dashboardType;
  const key = String(industry || "").toLowerCase();
  return key.includes("iot") || key.includes("デバイス") || key.includes("電力") ? "iot" : "manufacturing";
}

function manufacturingOverviewPanels() {
  return [
    ["Overall Equipment Effectiveness", "gauge", "percent", 40, 98, "設備総合効率を一目で確認"],
    ["Availability / Uptime", "stat", "percent", 60, 100, "現在のライン稼働率を確認"],
    ["Unplanned Downtime", "stat", "short", 0, 120, "直近の計画外停止時間を分単位で確認"],
    ["Active Alarm Count", "stat", "short", 0, 20, "未解決アラーム件数を確認"],
    {
      title: "Maintenance Action Queue",
      visualization: "table",
      unit: "short",
      min: 0,
      max: 1,
      purpose: "保全担当が次に確認する設備、優先度、推奨対応を一覧化",
      latestOnly: true,
      scenarioId: "csv_content",
      csvContent: "priority,asset,status,recommendation,owner,due\nHIGH,Press Brake,WARN,Inspect hydraulic pressure and servo load,Maintenance,Today\nHIGH,Compressor,WARN,Check air pressure leak and drain status,Utilities,Today\nMEDIUM,Laser Cutter,ONLINE,Review power trend and lens contamination,Production,This week\nMEDIUM,Motor Drive,ONLINE,Plan bearing vibration check,Maintenance,This week\nLOW,Ambient Sensor,ONLINE,Confirm calibration date,Quality,Next PM"
    },
    {
      title: "Production Loss Breakdown",
      visualization: "piechart",
      unit: "percent",
      min: 0,
      max: 100,
      purpose: "停止、段取り、速度低下、品質ロスの構成比を確認",
      latestOnly: true,
      scenarioId: "csv_content",
      csvContent: "loss_category,percent\nUnplanned Stop,36\nSetup Changeover,24\nMinor Stop,18\nSpeed Loss,14\nQuality Reject,8"
    },
    {
      title: "Shift Production Summary",
      visualization: "table",
      unit: "short",
      min: 0,
      max: 1,
      purpose: "シフト別の計画数、実績数、不良数、停止時間、達成率を確認",
      latestOnly: true,
      scenarioId: "csv_content",
      csvContent: "shift,planned_units,actual_units,reject_units,downtime_min,attainment_percent\nDay,620,594,8,18,95.8\nEvening,580,552,11,24,95.2\nNight,520,493,7,31,94.8\nToday Total,1720,1639,26,73,95.3"
    }
  ].map(panelFromTuple);
}

function enrichPanelsForDashboardType(panels, dashboardType) {
  const normalized = (Array.isArray(panels) ? panels : []).map(normalizePanel);
  const basePanels = dashboardType === "manufacturing"
    ? [...manufacturingOverviewPanels(), ...normalized]
    : normalized;
  const seen = new Set();
  return basePanels
    .filter((panel) => {
      const key = String(panel.title || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24)
    .map((panel, index) => normalizePanel({ ...panel, id: index + 1 }, index));
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
    panels: enrichPanelsForDashboardType(profile.panels.map(panelFromTuple), resolvedType)
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
  const defaultThresholds = thresholdValues(normalizedMin, normalizedMax, panel.unit);
  const warningThreshold = Number(panel.warningThreshold);
  const criticalThreshold = Number(panel.criticalThreshold);
  return {
    id: index + 1,
    title: String(panel.title || `Sensor Panel ${index + 1}`).slice(0, 80),
    visualization,
    unit: String(panel.unit || "short").slice(0, 32),
    min: normalizedMin,
    max: normalizedMax,
    warningThreshold: Number.isFinite(warningThreshold) ? warningThreshold : defaultThresholds.warning,
    criticalThreshold: Number.isFinite(criticalThreshold) ? criticalThreshold : defaultThresholds.critical,
    purpose: String(panel.purpose || "監視対象の状態を確認").slice(0, 160),
    latestOnly: visualization === "stat" || visualization === "gauge" || panel.latestOnly === true,
    scenarioId: panel.scenarioId === "csv_content" ? "csv_content" : "random_walk",
    csvContent: panel.scenarioId === "csv_content" ? String(panel.csvContent || "").slice(0, 4000) : ""
  };
}

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

function validatePanelDrafts(panels) {
  const errors = [];
  if (!Array.isArray(panels) || panels.length === 0) {
    return ["At least one panel is required."];
  }
  if (panels.length > 24) {
    errors.push("Panel count must be 24 or fewer.");
  }

  panels.forEach((panel, index) => {
    const label = `Panel ${index + 1}`;
    if (!panel || typeof panel !== "object") {
      errors.push(`${label}: panel must be an object.`);
      return;
    }
    if (!String(panel.title || "").trim()) {
      errors.push(`${label}: title is required.`);
    }
    if (String(panel.title || "").length > 80) {
      errors.push(`${label}: title must be 80 characters or fewer.`);
    }
    if (!VISUALIZATIONS.has(panel.visualization)) {
      errors.push(`${label}: visualization must be one of ${Array.from(VISUALIZATIONS).join(", ")}.`);
    }

    const min = Number(panel.min);
    const max = Number(panel.max);
    if (!Number.isFinite(min)) {
      errors.push(`${label}: min must be a number.`);
    }
    if (!Number.isFinite(max)) {
      errors.push(`${label}: max must be a number.`);
    }
    if (Number.isFinite(min) && Number.isFinite(max) && max <= min) {
      errors.push(`${label}: max must be greater than min.`);
    }

    const warningInput = Number(panel.warningThreshold);
    const criticalInput = Number(panel.criticalThreshold);
    if (hasValue(panel.warningThreshold) && !Number.isFinite(warningInput)) {
      errors.push(`${label}: warning threshold must be a number.`);
    }
    if (hasValue(panel.criticalThreshold) && !Number.isFinite(criticalInput)) {
      errors.push(`${label}: critical threshold must be a number.`);
    }
    if (Number.isFinite(min) && Number.isFinite(max)) {
      const defaults = thresholdValues(min, max, panel.unit);
      const warning = Number.isFinite(warningInput) ? warningInput : defaults.warning;
      const critical = Number.isFinite(criticalInput) ? criticalInput : defaults.critical;
      if (warning >= critical) {
        errors.push(`${label}: warning threshold must be lower than critical threshold.`);
      }
      if (Number.isFinite(warning) && (warning < min || warning > max)) {
        errors.push(`${label}: warning threshold must be within min and max.`);
      }
      if (Number.isFinite(critical) && (critical < min || critical > max)) {
        errors.push(`${label}: critical threshold must be within min and max.`);
      }
    }
  });

  return errors;
}

function validateAiProposal(raw, industry, dashboardType) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.panels)) {
    throw new Error("AI proposal response did not include panels.");
  }
  const resolvedType = resolveDashboardType(industry, dashboardType);
  const profile = fallbackProfile(resolvedType);
  const base = createProposalFromProfile(industry, resolvedType, profile, "ai");
  const panelCount = Math.min(Math.max(raw.panels.length, 5), 10);
  const panels = enrichPanelsForDashboardType(raw.panels.slice(0, panelCount).map(normalizePanel), resolvedType);
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
          required: [
            "title",
            "visualization",
            "unit",
            "min",
            "max",
            "warningThreshold",
            "criticalThreshold",
            "purpose",
            "latestOnly",
            "scenarioId",
            "csvContent"
          ],
          properties: {
            title: { type: "string" },
            visualization: { type: "string", enum: ["timeseries", "stat", "gauge", "piechart", "table"] },
            unit: { type: "string" },
            min: { type: "number" },
            max: { type: "number" },
            warningThreshold: { type: "number" },
            criticalThreshold: { type: "number" },
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
Each panel must include warningThreshold and criticalThreshold within or near the min/max range.
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

function thresholdValues(min, max, unit) {
  const span = max - min;
  if (unit === "celsius" || unit === "amp" || unit === "dB" || unit === "accMS2") {
    return {
      warning: min + span * 0.75,
      critical: min + span * 0.9
    };
  }
  return {
    warning: min + span * 0.8,
    critical: max
  };
}

function thresholds(min, max, unit, warningThreshold, criticalThreshold) {
  const defaultThresholds = thresholdValues(min, max, unit);
  const warning = Number.isFinite(Number(warningThreshold)) ? Number(warningThreshold) : defaultThresholds.warning;
  const critical = Number.isFinite(Number(criticalThreshold)) ? Number(criticalThreshold) : defaultThresholds.critical;
  if (warning <= critical) {
    return [
      { color: "green", value: null },
      { color: "yellow", value: warning },
      { color: "red", value: critical }
    ];
  }
  return [
    { color: "green", value: null },
    { color: "red", value: critical },
    { color: "yellow", value: warning }
  ];
}

function grafanaPanel(panel, index, gridPos) {
  const normalized = normalizePanel(panel, index);
  const type =
    normalized.visualization === "gauge"
      ? "gauge"
      : normalized.visualization === "stat"
        ? "stat"
        : normalized.visualization === "piechart"
          ? "piechart"
          : normalized.visualization === "table"
            ? "table"
            : "timeseries";
  const target = {
    refId: "A",
    datasource: { type: "grafana-testdata-datasource", uid: "testdata" },
    scenarioId: normalized.scenarioId || "random_walk",
    alias: normalized.title,
    seriesCount: 1,
    min: Number(normalized.min),
    max: Number(normalized.max)
  };
  if (normalized.csvContent) {
    target.csvContent = normalized.csvContent;
  }
  const base = {
    id: index + 1,
    type,
    title: normalized.title,
    description: `${normalized.purpose || ""} Mock range: ${normalized.min}-${normalized.max} ${normalized.unit}. Warning: ${normalized.warningThreshold}, Critical: ${normalized.criticalThreshold}.`.trim(),
    datasource: { type: "grafana-testdata-datasource", uid: "testdata" },
    gridPos,
    targets: [target],
    fieldConfig: {
      defaults: {
        unit: normalized.unit || "short",
        min: Number(normalized.min),
        max: Number(normalized.max),
        decimals: Number(normalized.max) <= 1 ? 3 : 1,
        thresholds: {
          mode: "absolute",
          steps: thresholds(Number(normalized.min), Number(normalized.max), normalized.unit, normalized.warningThreshold, normalized.criticalThreshold)
        }
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

async function listDatasources() {
  const datasources = await grafana("/api/datasources");
  return datasources
    .map((datasource) => ({
      uid: datasource.uid || "",
      name: datasource.name || datasource.uid || "Untitled",
      type: datasource.type || "",
      isDefault: Boolean(datasource.isDefault),
      access: datasource.access || ""
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, "ja"));
}

function queryHintForDatasource(type, panel) {
  const name = String(panel.title || "metric").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "metric";
  if (type.includes("prometheus")) {
    return `${name}{device_id="$device"} or avg_over_time(${name}[5m])`;
  }
  if (type.includes("influx")) {
    return `from(bucket: "factory") |> range(start: v.timeRangeStart) |> filter(fn: (r) => r._measurement == "${name}")`;
  }
  if (type.includes("postgres") || type.includes("mysql") || type.includes("mssql")) {
    return `select time, value from sensor_readings where metric = '${name}' order by time`;
  }
  if (type.includes("infinity")) {
    return `/api/metrics/${name}`;
  }
  return `Replace TestData random_walk with the production metric for ${panel.title || name}.`;
}

function datasourceReplacementPlan(panels, datasource) {
  const rows = (Array.isArray(panels) && panels.length ? panels : []).map(normalizePanel);
  return rows.map((panel) => ({
    panelTitle: panel.title,
    visualization: panel.visualization,
    currentDatasourceUid: "testdata",
    targetDatasourceUid: datasource.uid || "",
    targetDatasourceName: datasource.name || "",
    targetDatasourceType: datasource.type || "",
    unit: panel.unit,
    expectedRange: `${panel.min}-${panel.max}`,
    queryHint: queryHintForDatasource(String(datasource.type || ""), panel),
    validationPoint: panel.latestOnly
      ? "最新値が想定範囲内で取得できることを確認する"
      : "時系列のtimestamp/valueがGrafanaの選択時間範囲で取得できることを確認する"
  }));
}

function runtimeStatus() {
  return {
    ok: true,
    service: "grafana-dashboard-builder",
    time: new Date().toISOString(),
    grafanaUrl: GRAFANA_URL,
    grafanaTokenConfigured: Boolean(TOKEN),
    appAccessTokenEnabled: Boolean(APP_ACCESS_TOKEN),
    aiProvider: AI_PROVIDER,
    openAiKeyConfigured: Boolean(OPENAI_API_KEY),
    vertexProjectConfigured: Boolean(VERTEX_AI_PROJECT),
    vertexLocation: VERTEX_AI_LOCATION,
    vertexModel: VERTEX_AI_MODEL,
    firestoreHistoryEnabled: FIRESTORE_HISTORY_ENABLED,
    firestoreProjectConfigured: Boolean(FIRESTORE_PROJECT),
    firestoreDatabase: FIRESTORE_DATABASE,
    firestoreCollection: FIRESTORE_HISTORY_COLLECTION,
    rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
    appLogEvents: appLogState.events.length,
    mobileSensorPoints: mobileSensorState.points.length,
    mobileSensorDevices: mobileSensorState.devices.size,
    dashboardHistoryCount: dashboardHistory(100).length
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-App-Access-Token"
  });
  res.end(body);
}

function appAccessTokenFromRequest(req) {
  const direct = req.headers["x-app-access-token"];
  if (typeof direct === "string" && direct) return direct;
  const authorization = req.headers.authorization || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function isAiGetWithModelRequest(req) {
  if (req.method !== "GET") return false;
  if (!req.url.startsWith("/api/ai/failure-risk") && !req.url.startsWith("/api/ai/analyze-log")) return false;
  const parsed = new URL(req.url, "http://localhost");
  return parsed.searchParams.get("ai") === "true";
}

function isProtectedUiApi(req) {
  if (!APP_ACCESS_TOKEN) return false;
  if (req.method === "GET" && req.url.startsWith("/api/logs/recent")) return true;
  if (isAiGetWithModelRequest(req)) return true;
  if (req.method === "GET" && (req.url === "/api/health" || req.url === "/api/runtime-status" || req.url === "/api/folders" || req.url === "/api/datasources" || req.url.startsWith("/api/dashboard-history"))) return true;
  if (req.method !== "POST") return false;
  return [
    "/api/propose",
    "/api/datasource-replacement-plan",
    "/api/create-dashboard",
    "/api/mobile-sensor/demo-data",
    "/api/mobile-sensor/reset",
    "/api/mobile-sensor/demo-scenario",
    "/api/ai/failure-risk",
    "/api/ai/analyze-log"
  ].includes(req.url);
}

function hasValidAppAccess(req) {
  return !APP_ACCESS_TOKEN || appAccessTokenFromRequest(req) === APP_ACCESS_TOKEN;
}

function requestActor(req) {
  const iapEmail = req.headers["x-goog-authenticated-user-email"];
  if (typeof iapEmail === "string" && iapEmail) return truncateText(iapEmail.replace(/^accounts\.google\.com:/, ""), 160);
  const forwardedEmail = req.headers["x-forwarded-email"];
  if (typeof forwardedEmail === "string" && forwardedEmail) return truncateText(forwardedEmail, 160);
  return "";
}

function clientAddress(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimitedApi(req) {
  if (RATE_LIMIT_MAX_REQUESTS <= 0 || RATE_LIMIT_WINDOW_MS <= 0) return false;
  if (req.method !== "POST") return false;
  return [
    "/api/propose",
    "/api/datasource-replacement-plan",
    "/api/create-dashboard",
    "/api/mobile-sensor/demo-data",
    "/api/mobile-sensor/reset",
    "/api/mobile-sensor/demo-scenario",
    "/api/ai/failure-risk",
    "/api/ai/analyze-log"
  ].includes(req.url);
}

function rateLimitResult(req) {
  const now = Date.now();
  const windowMs = Number.isFinite(RATE_LIMIT_WINDOW_MS) ? RATE_LIMIT_WINDOW_MS : 60000;
  const maxRequests = Number.isFinite(RATE_LIMIT_MAX_REQUESTS) ? RATE_LIMIT_MAX_REQUESTS : 30;
  const key = `${clientAddress(req)}:${req.url}`;
  let entry = rateLimitState.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  rateLimitState.set(key, entry);

  for (const [entryKey, value] of rateLimitState.entries()) {
    if (value.resetAt <= now) rateLimitState.delete(entryKey);
  }

  return {
    limited: entry.count > maxRequests,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
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

function numberOrDefault(value, defaultValue = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : defaultValue;
}

function cleanDeviceId(value) {
  return String(value || "android-demo-001")
    .replace(/[^a-zA-Z0-9_.-]/g, "-")
    .slice(0, 64) || "android-demo-001";
}

function isoTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function buildMobileSensorPoint(body) {
  const accelX = numberOrDefault(body.accelX);
  const accelY = numberOrDefault(body.accelY);
  const accelZ = numberOrDefault(body.accelZ);
  const providedMagnitude = Number(body.accelMagnitude);
  const accelMagnitude = Number.isFinite(providedMagnitude)
    ? providedMagnitude
    : Math.sqrt(accelX * accelX + accelY * accelY + accelZ * accelZ);
  const shock = body.shock === true || body.shock === 1 || body.shock === "true";
  const timestamp = isoTimestamp(body.timestamp);
  return {
    time: timestamp,
    epochMs: new Date(timestamp).getTime(),
    deviceId: cleanDeviceId(body.deviceId),
    accelX,
    accelY,
    accelZ,
    accelMagnitude,
    shock,
    shockValue: shock ? 1 : 0,
    tapCount: Math.max(0, Math.trunc(numberOrDefault(body.tapCount))),
    batteryPercent: Math.max(0, Math.min(100, numberOrDefault(body.batteryPercent, 100))),
    status: String(body.status || "ONLINE").toUpperCase() === "OFFLINE" ? "OFFLINE" : String(body.status || "ONLINE").toUpperCase() === "WARN" ? "WARN" : "ONLINE"
  };
}

function storeMobileSensorPoint(point) {
  mobileSensorState.points.push(point);
  if (mobileSensorState.points.length > MOBILE_SENSOR_MAX_POINTS) {
    mobileSensorState.points.splice(0, mobileSensorState.points.length - MOBILE_SENSOR_MAX_POINTS);
  }
  mobileSensorState.devices.set(point.deviceId, {
    deviceId: point.deviceId,
    time: point.time,
    epochMs: point.epochMs,
    accelMagnitude: point.accelMagnitude,
    tapCount: point.tapCount,
    batteryPercent: point.batteryPercent,
    status: point.status,
    online: point.status === "OFFLINE" ? 0 : 1,
    message: point.status === "OFFLINE" ? "no data" : point.status === "WARN" ? "check sensor" : "streaming"
  });
}

function mobileSensorHistory(limit = 500, deviceId = "") {
  const cleanId = deviceId ? cleanDeviceId(deviceId) : "";
  const rows = cleanId ? mobileSensorState.points.filter((point) => point.deviceId === cleanId) : mobileSensorState.points;
  return rows.slice(-Math.max(1, Math.min(2000, Number(limit) || 500)));
}

function demoWaveValue(index, total, mode) {
  const phase = (index / Math.max(1, total - 1)) * Math.PI * 8;
  const base = mode === "critical" ? 13.4 : mode === "warn" ? 11.2 : 9.82;
  const amplitude = mode === "critical" ? 4.2 : mode === "warn" ? 2.1 : 0.25;
  const trend = mode === "critical" ? (index / Math.max(1, total - 1)) * 2.4 : mode === "warn" ? (index / Math.max(1, total - 1)) * 0.9 : 0;
  const pulse = mode !== "normal" && index % 17 === 0 ? (mode === "critical" ? 5.5 : 2.8) : 0;
  return Math.max(0.01, base + Math.sin(phase) * amplitude + Math.sin(phase / 3) * amplitude * 0.35 + trend + pulse);
}

function generateDemoSensorData(options = {}) {
  const deviceId = cleanDeviceId(options.deviceId || "android-demo-001");
  const mode = ["normal", "warn", "critical"].includes(String(options.mode || "").toLowerCase())
    ? String(options.mode).toLowerCase()
    : "warn";
  const count = Math.max(10, Math.min(1000, Math.trunc(numberOrDefault(options.count, 240))));
  const intervalMs = Math.max(100, Math.min(10000, Math.trunc(numberOrDefault(options.intervalMs, 1000))));
  const now = Date.now();
  const start = now - (count - 1) * intervalMs;
  const baseTap = Math.max(0, Math.trunc(numberOrDefault(options.startTapCount, 0)));
  const points = [];
  let tapCount = baseTap;

  for (let index = 0; index < count; index += 1) {
    const magnitude = demoWaveValue(index, count, mode);
    const shock = mode === "critical" ? index % 13 === 0 || magnitude >= 16 : mode === "warn" ? index % 37 === 0 || magnitude >= 13 : false;
    if (shock) tapCount += 1;
    const angle = index / 8;
    const accelX = Math.sin(angle) * magnitude * 0.28;
    const accelY = Math.cos(angle / 1.7) * magnitude * 0.22;
    const accelZ = Math.sqrt(Math.max(0.01, magnitude * magnitude - accelX * accelX - accelY * accelY));
    const point = buildMobileSensorPoint({
      deviceId,
      timestamp: new Date(start + index * intervalMs).toISOString(),
      accelX,
      accelY,
      accelZ,
      accelMagnitude: magnitude,
      shock,
      tapCount,
      batteryPercent: Math.max(5, mode === "critical" ? 58 - index / count * 8 : 82 - index / count * 3),
      status: mode === "critical" && index > count * 0.9 ? "WARN" : "ONLINE"
    });
    storeMobileSensorPoint(point);
    points.push(point);
  }

  mobileSensorState.aiAnalysisCache.clear();
  return {
    deviceId,
    mode,
    count,
    intervalMs,
    firstTime: points[0]?.time || "",
    lastTime: points[points.length - 1]?.time || "",
    maxMagnitude: roundNumber(Math.max(...points.map((point) => point.accelMagnitude))),
    shockCount: points.filter((point) => point.shock).length
  };
}

function resetMobileSensorData(deviceId = "") {
  const cleanId = deviceId ? cleanDeviceId(deviceId) : "";
  const beforePoints = mobileSensorState.points.length;
  const beforeDevices = mobileSensorState.devices.size;
  if (cleanId) {
    mobileSensorState.points = mobileSensorState.points.filter((point) => point.deviceId !== cleanId);
    mobileSensorState.devices.delete(cleanId);
  } else {
    mobileSensorState.points = [];
    mobileSensorState.devices.clear();
  }
  mobileSensorState.aiAnalysisCache.clear();
  return {
    deviceId: cleanId,
    resetScope: cleanId ? "device" : "all",
    removedPoints: beforePoints - mobileSensorState.points.length,
    removedDevices: beforeDevices - mobileSensorState.devices.size
  };
}

async function runDemoScenario(options = {}) {
  const deviceId = cleanDeviceId(options.deviceId || "android-demo-001");
  const mode = ["normal", "warn", "critical"].includes(String(options.mode || "").toLowerCase())
    ? String(options.mode).toLowerCase()
    : "warn";
  const count = Math.max(10, Math.min(1000, Math.trunc(numberOrDefault(options.count, 240))));
  const reset = resetMobileSensorData(deviceId);
  const generated = generateDemoSensorData({
    deviceId,
    mode,
    count,
    intervalMs: options.intervalMs || 1000
  });
  const analysis = await buildFailureRiskAnalysis(deviceId, options.windowMinutes || 10, options.useAi !== false);
  return {
    deviceId,
    mode,
    reset,
    generated,
    analysis
  };
}

function prometheusLine(name, labels, value, epochMs) {
  const labelText = Object.entries(labels)
    .map(([key, labelValue]) => `${key}="${String(labelValue).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `${name}{${labelText}} ${Number(value) || 0} ${epochMs}`;
}

function mobileSensorPrometheusText() {
  const latest = Array.from(mobileSensorState.devices.values());
  const lines = [
    "# HELP mobile_sensor_accel_magnitude Acceleration magnitude from Android demo device.",
    "# TYPE mobile_sensor_accel_magnitude gauge",
    "# HELP mobile_sensor_battery_percent Battery percent from Android demo device.",
    "# TYPE mobile_sensor_battery_percent gauge",
    "# HELP mobile_sensor_online Online state from Android demo device.",
    "# TYPE mobile_sensor_online gauge"
  ];
  for (const point of latest) {
    const labels = { device_id: point.deviceId };
    lines.push(prometheusLine("mobile_sensor_accel_magnitude", labels, point.accelMagnitude, point.epochMs));
    lines.push(prometheusLine("mobile_sensor_battery_percent", labels, point.batteryPercent, point.epochMs));
    lines.push(prometheusLine("mobile_sensor_online", labels, point.online, point.epochMs));
    lines.push(prometheusLine("mobile_sensor_tap_count", labels, point.tapCount, point.epochMs));
  }
  return `${lines.join("\n")}\n`;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = average(values);
  return Math.sqrt(average(values.map((value) => (value - avg) ** 2)));
}

function roundNumber(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((Number(value) || 0) * multiplier) / multiplier;
}

function truncateText(value, maxLength = 500) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function recordAppEvent(type, detail = {}) {
  const event = {
    time: new Date().toISOString(),
    epochMs: Date.now(),
    type: truncateText(type, 80),
    level: detail.level === "error" ? "error" : detail.level === "warn" ? "warn" : "info",
    message: truncateText(detail.message || type, 300),
    route: truncateText(detail.route || "", 120),
    deviceId: detail.deviceId ? cleanDeviceId(detail.deviceId) : "",
    dashboardUid: truncateText(detail.dashboardUid || "", 120),
    dashboardTitle: truncateText(detail.dashboardTitle || "", 180),
    dashboardType: truncateText(detail.dashboardType || "", 80),
    dashboardUrl: truncateText(detail.dashboardUrl || "", 500),
    folderUid: truncateText(detail.folderUid || "", 120),
    industry: truncateText(detail.industry || "", 120),
    actor: truncateText(detail.actor || "", 160),
    statusCode: Number.isFinite(Number(detail.statusCode)) ? Number(detail.statusCode) : 0,
    durationMs: Number.isFinite(Number(detail.durationMs)) ? Number(detail.durationMs) : 0
  };
  appLogState.events.push(event);
  if (appLogState.events.length > APP_LOG_MAX_EVENTS) {
    appLogState.events.splice(0, appLogState.events.length - APP_LOG_MAX_EVENTS);
  }
  return event;
}

function recentAppEvents(limit = 100) {
  return appLogState.events.slice(-Math.max(1, Math.min(500, Number(limit) || 100)));
}

function dashboardHistory(limit = 20) {
  return recentAppEvents(500)
    .filter((event) => event.type === "dashboard_created")
    .slice(-Math.max(1, Math.min(100, Number(limit) || 20)))
    .reverse()
    .map((event) => ({
      time: event.time,
      dashboardUid: event.dashboardUid,
      dashboardTitle: event.dashboardTitle,
      dashboardType: event.dashboardType,
      dashboardUrl: event.dashboardUrl,
      folderUid: event.folderUid,
      industry: event.industry,
      message: event.message
    }));
}

function firestoreString(value) {
  return { stringValue: String(value || "") };
}

function firestoreDocumentFromDashboard(row) {
  return {
    fields: {
      time: { timestampValue: row.time || new Date().toISOString() },
      dashboardUid: firestoreString(row.dashboardUid),
      dashboardTitle: firestoreString(row.dashboardTitle),
      dashboardType: firestoreString(row.dashboardType),
      dashboardUrl: firestoreString(row.dashboardUrl),
      folderUid: firestoreString(row.folderUid),
      industry: firestoreString(row.industry),
      actor: firestoreString(row.actor),
      message: firestoreString(row.message)
    }
  };
}

function firestoreFieldValue(field) {
  if (!field) return "";
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.timestampValue !== undefined) return field.timestampValue;
  return "";
}

function dashboardRowFromFirestore(document) {
  const fields = document.fields || {};
  return {
    time: firestoreFieldValue(fields.time),
    dashboardUid: firestoreFieldValue(fields.dashboardUid),
    dashboardTitle: firestoreFieldValue(fields.dashboardTitle),
    dashboardType: firestoreFieldValue(fields.dashboardType),
    dashboardUrl: firestoreFieldValue(fields.dashboardUrl),
    folderUid: firestoreFieldValue(fields.folderUid),
    industry: firestoreFieldValue(fields.industry),
    actor: firestoreFieldValue(fields.actor),
    message: firestoreFieldValue(fields.message)
  };
}

function firestoreBaseUrl() {
  if (!FIRESTORE_PROJECT) {
    throw new Error("FIRESTORE_PROJECT, VERTEX_AI_PROJECT, GOOGLE_CLOUD_PROJECT, or GCLOUD_PROJECT is required for Firestore history.");
  }
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(FIRESTORE_PROJECT)}/databases/${encodeURIComponent(FIRESTORE_DATABASE)}/documents/${encodeURIComponent(FIRESTORE_HISTORY_COLLECTION)}`;
}

async function saveDashboardHistoryToFirestore(row) {
  if (!FIRESTORE_HISTORY_ENABLED) return false;
  const token = await getGoogleAccessToken();
  const documentId = `${Date.now()}-${String(row.dashboardUid || "dashboard").replace(/[^a-zA-Z0-9_-]/g, "_")}`.slice(0, 180);
  const response = await fetch(`${firestoreBaseUrl()}?documentId=${encodeURIComponent(documentId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(firestoreDocumentFromDashboard(row))
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore history save failed: ${response.status} ${text}`);
  }
  return true;
}

async function firestoreDashboardHistory(limit = 20) {
  if (!FIRESTORE_HISTORY_ENABLED) return [];
  const token = await getGoogleAccessToken();
  const pageSize = Math.max(1, Math.min(100, Number(limit) || 20));
  const response = await fetch(`${firestoreBaseUrl()}?pageSize=${pageSize}&orderBy=time%20desc`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore history read failed: ${response.status} ${text}`);
  }
  const data = await response.json();
  return (data.documents || []).map(dashboardRowFromFirestore);
}

function logAnalysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "riskLevel", "likelyCause", "recommendedAction"],
    properties: {
      summary: { type: "string" },
      riskLevel: { type: "string" },
      likelyCause: { type: "string" },
      recommendedAction: { type: "string" }
    }
  };
}

function summarizeLogStats(events) {
  const now = Date.now();
  const errors = events.filter((event) => event.level === "error");
  const warnings = events.filter((event) => event.level === "warn");
  const byType = {};
  const byRoute = {};
  for (const event of events) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    if (event.route) byRoute[event.route] = (byRoute[event.route] || 0) + 1;
  }
  const latest = events.length ? events[events.length - 1] : null;
  const recentErrors = errors.filter((event) => now - event.epochMs <= 30 * 60 * 1000);
  let riskLevel = "OK";
  let riskScore = 0;
  if (recentErrors.length >= 5) riskScore += 75;
  else if (recentErrors.length >= 2) riskScore += 50;
  else if (recentErrors.length === 1) riskScore += 30;
  if (warnings.length >= 5) riskScore += 20;
  if (events.length === 0) riskScore = 10;
  riskScore = Math.min(100, riskScore);
  if (riskScore >= 75) riskLevel = "CRITICAL";
  else if (riskScore >= 50) riskLevel = "WARN";
  else if (riskScore >= 20) riskLevel = "INFO";
  return {
    eventCount: events.length,
    errorCount: errors.length,
    warningCount: warnings.length,
    recentErrorCount: recentErrors.length,
    riskLevel,
    riskScore,
    latestTime: latest?.time || "",
    latestMessage: latest?.message || "",
    byType,
    byRoute,
    sampleEvents: events.slice(-20)
  };
}

function deterministicLogAnalysis(stats) {
  if (!stats.eventCount) {
    return {
      summary: "解析対象のアプリイベントログがまだありません。",
      riskLevel: "INFO",
      likelyCause: "Cloud Run起動直後、またはまだUI/API操作が行われていない状態です。",
      recommendedAction: "パネル案作成、ダッシュボード作成、Androidセンサー送信、AI診断を実行してから再度確認してください。"
    };
  }
  if (stats.riskLevel === "CRITICAL" || stats.riskLevel === "WARN") {
    return {
      summary: `直近ログにエラーが${stats.recentErrorCount}件あります。`,
      riskLevel: stats.riskLevel,
      likelyCause: "Grafana API、Vertex AI、ネットワーク、入力値、または認証設定の問題が考えられます。",
      recommendedAction: "最新エラーのrouteとmessageを確認し、Grafana token、Vertex AI権限、Cloud Run環境変数、入力データを確認してください。"
    };
  }
  return {
    summary: "直近のアプリイベントログに大きな異常はありません。",
    riskLevel: stats.riskLevel,
    likelyCause: "主要APIは正常に処理されています。",
    recommendedAction: "営業デモでは、失敗時の説明例としてGrafana APIエラーやAI生成失敗のケースを意図的に確認できます。"
  };
}

function logAnalysisPrompt(stats) {
  return [
    "You are analyzing recent app events for a Grafana dashboard builder sales demo.",
    "Write concise Japanese operational diagnostics.",
    "Do not expose secrets. Focus on likely causes and next actions.",
    `Stats and events: ${JSON.stringify(stats).slice(0, 8000)}`
  ].join("\n");
}

async function logAnalysisWithVertex(stats) {
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
              "You write concise Japanese diagnostics for app logs. Return only JSON matching the schema."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: logAnalysisPrompt(stats) }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: logAnalysisSchema()
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Vertex AI returned ${response.status}`);
  }
  return JSON.parse(extractVertexText(data));
}

async function logAnalysisWithOpenAi(stats) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
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
            "You write concise Japanese diagnostics for app logs. Return only data matching the JSON schema."
        },
        {
          role: "user",
          content: logAnalysisPrompt(stats)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "app_log_analysis",
          strict: true,
          schema: logAnalysisSchema()
        }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API returned ${response.status}`);
  }
  return JSON.parse(extractResponseText(data));
}

async function buildLogAnalysis(limit = 100, useAi = true) {
  const events = recentAppEvents(limit);
  const stats = summarizeLogStats(events);
  const cacheKey = `${limit}:${stats.eventCount}:${stats.latestTime}`;
  const cached = appLogState.aiLogCache.get(cacheKey);
  if (useAi && cached && Date.now() - cached.cachedAt < AI_ANALYSIS_CACHE_TTL_MS) {
    return {
      ...stats,
      ...cached.text,
      aiProvider: cached.aiProvider,
      aiCached: true,
      generatedAt: cached.generatedAt
    };
  }

  let text = deterministicLogAnalysis(stats);
  let aiProvider = "rules";
  if (useAi) {
    try {
      text = AI_PROVIDER === "openai" ? await logAnalysisWithOpenAi(stats) : await logAnalysisWithVertex(stats);
      aiProvider = AI_PROVIDER;
    } catch (error) {
      text = {
        ...text,
        recommendedAction: `${text.recommendedAction} AIログ解析は失敗したため、ルール判定を表示しています。原因: ${error.message}`
      };
    }
  }

  const generatedAt = new Date().toISOString();
  if (useAi) {
    appLogState.aiLogCache.set(cacheKey, {
      cachedAt: Date.now(),
      generatedAt,
      aiProvider,
      text
    });
  }
  return {
    ...stats,
    ...text,
    aiProvider,
    aiCached: false,
    generatedAt
  };
}

function maintenanceAnalysisSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "possibleCause", "recommendedAction"],
    properties: {
      summary: { type: "string" },
      possibleCause: { type: "string" },
      recommendedAction: { type: "string" }
    }
  };
}

function deterministicMaintenanceText(stats) {
  if (!stats.sampleCount) {
    return {
      summary: "センサーデータがまだ受信されていません。",
      possibleCause: "Androidアプリが停止している、またはCloud Run APIへ送信されていない可能性があります。",
      recommendedAction: "AndroidアプリのStart状態、API URL、ネットワーク接続を確認してください。"
    };
  }
  if (stats.status === "OFFLINE" || stats.staleSeconds > 120) {
    return {
      summary: "デバイス通信が途切れている可能性があります。",
      possibleCause: "端末のスリープ、通信断、アプリ停止、またはCloud Runの再起動が考えられます。",
      recommendedAction: "端末の画面ON状態、アプリの送信状態、Cloud Runの稼働状態を確認してください。"
    };
  }
  if (stats.riskLevel === "CRITICAL") {
    return {
      summary: "振動または衝撃イベントが高い状態です。",
      possibleCause: "設備の固定ゆるみ、軸受劣化、設置面の変化、突発的な衝撃が考えられます。",
      recommendedAction: "デモではスマホを強く振った状態です。本番設備では停止タイミングで固定部、軸受、潤滑、異音を点検してください。"
    };
  }
  if (stats.riskLevel === "WARN") {
    return {
      summary: "通常より振動変動が大きくなっています。",
      possibleCause: "軽微な揺れ、取り付け状態の変化、周辺振動の影響が考えられます。",
      recommendedAction: "直近トレンドを継続確認し、同時に電流・温度・騒音も上昇する場合は保全確認を行ってください。"
    };
  }
  if (stats.riskLevel === "INFO") {
    return {
      summary: "軽微な振動変化を検出しています。",
      possibleCause: "スマホの移動、画面タップ、周辺振動などの一時的な変化が考えられます。",
      recommendedAction: "デモではこの状態からスマホをさらに振り、WARNまたはCRITICALへの変化を確認してください。"
    };
  }
  return {
    summary: "直近の振動状態は安定しています。",
    possibleCause: "大きな衝撃や通信異常は検出されていません。",
    recommendedAction: "デモではスマホを振る、または画面をタップして波形と診断結果の変化を確認してください。"
  };
}

function buildMaintenanceStats(deviceId, windowMinutes) {
  const cleanId = cleanDeviceId(deviceId);
  const minutes = Math.max(1, Math.min(120, Number(windowMinutes) || 10));
  const now = Date.now();
  const windowStart = now - minutes * 60 * 1000;
  const rows = mobileSensorHistory(2000, cleanId).filter((point) => point.epochMs >= windowStart);
  const latest = rows.length ? rows[rows.length - 1] : mobileSensorState.devices.get(cleanId);
  const magnitudes = rows.map((point) => point.accelMagnitude);
  const shocks = rows.filter((point) => point.shock).length;
  const tapDelta = rows.length ? Math.max(0, rows[rows.length - 1].tapCount - rows[0].tapCount) : 0;
  const maxMagnitude = magnitudes.length ? Math.max(...magnitudes) : 0;
  const avgMagnitude = average(magnitudes);
  const stdMagnitude = standardDeviation(magnitudes);
  const staleSeconds = latest?.epochMs ? Math.max(0, Math.round((now - latest.epochMs) / 1000)) : 0;
  const status = latest?.status || "NO_DATA";
  let riskScore = 0;

  if (!rows.length) riskScore += 10;
  if (status === "OFFLINE") riskScore += 80;
  if (staleSeconds > 120) riskScore += 55;
  else if (staleSeconds > 30) riskScore += 25;
  if (maxMagnitude >= 16) riskScore += 35;
  else if (maxMagnitude >= 12) riskScore += 20;
  if (avgMagnitude >= 12) riskScore += 20;
  if (stdMagnitude >= 2.5) riskScore += 25;
  else if (stdMagnitude >= 1.2) riskScore += 12;
  if (shocks >= 10 || tapDelta >= 10) riskScore += 25;
  else if (shocks >= 3 || tapDelta >= 3) riskScore += 12;
  if ((latest?.batteryPercent || 100) < 20) riskScore += 10;

  riskScore = Math.max(0, Math.min(100, Math.round(riskScore)));
  const riskLevel = riskScore >= 80 ? "CRITICAL" : riskScore >= 50 ? "WARN" : riskScore >= 20 ? "INFO" : "OK";
  return {
    deviceId: cleanId,
    windowMinutes: minutes,
    riskLevel,
    riskScore,
    sampleCount: rows.length,
    latestTime: latest?.time || "",
    staleSeconds,
    status,
    avgMagnitude: roundNumber(avgMagnitude),
    maxMagnitude: roundNumber(maxMagnitude),
    stdMagnitude: roundNumber(stdMagnitude),
    shockCount: shocks,
    tapDelta,
    batteryPercent: roundNumber(latest?.batteryPercent || 0, 0)
  };
}

function maintenancePrompt(stats) {
  return [
    "Android smartphone accelerometer data is used as a vibration sensor demo for maintenance sales.",
    "Create concise Japanese maintenance comments for a Grafana dashboard.",
    "Do not claim a real failure is confirmed. Present likely causes and next actions.",
    `Stats: ${JSON.stringify(stats)}`
  ].join("\n");
}

async function maintenanceTextWithVertex(stats) {
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
              "You write concise Japanese maintenance diagnostics for Grafana panels. Return only JSON matching the schema."
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: maintenancePrompt(stats) }]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: maintenanceAnalysisSchema()
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `Vertex AI returned ${response.status}`);
  }
  return JSON.parse(extractVertexText(data));
}

async function maintenanceTextWithOpenAi(stats) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
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
            "You write concise Japanese maintenance diagnostics for Grafana panels. Return only data matching the JSON schema."
        },
        {
          role: "user",
          content: maintenancePrompt(stats)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "maintenance_diagnostic",
          strict: true,
          schema: maintenanceAnalysisSchema()
        }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API returned ${response.status}`);
  }
  return JSON.parse(extractResponseText(data));
}

async function buildFailureRiskAnalysis(deviceId = "android-demo-001", windowMinutes = 10, useAi = true) {
  const stats = buildMaintenanceStats(deviceId, windowMinutes);
  const cacheKey = `${stats.deviceId}:${stats.windowMinutes}`;
  const cached = mobileSensorState.aiAnalysisCache.get(cacheKey);
  if (useAi && cached && Date.now() - cached.cachedAt < AI_ANALYSIS_CACHE_TTL_MS) {
    return {
      ...stats,
      ...cached.text,
      aiProvider: cached.aiProvider,
      aiCached: true,
      generatedAt: cached.generatedAt
    };
  }

  let text = deterministicMaintenanceText(stats);
  let aiProvider = "rules";
  if (useAi) {
    try {
      text = AI_PROVIDER === "openai" ? await maintenanceTextWithOpenAi(stats) : await maintenanceTextWithVertex(stats);
      aiProvider = AI_PROVIDER;
    } catch (error) {
      text = {
        ...text,
        recommendedAction: `${text.recommendedAction} AIコメント生成は失敗したため、ルール判定を表示しています。原因: ${error.message}`
      };
    }
  }

  const generatedAt = new Date().toISOString();
  if (useAi) {
    mobileSensorState.aiAnalysisCache.set(cacheKey, {
      cachedAt: Date.now(),
      generatedAt,
      aiProvider,
      text
    });
  }
  return {
    ...stats,
    ...text,
    aiProvider,
    aiCached: false,
    generatedAt
  };
}

function shippingKpiRows() {
  return [
    { metric: "api_db_health", value: 1, unit: "bool", status: "OK" },
    { metric: "open_shipments", value: 18, unit: "count", status: "WARN" },
    { metric: "pending_inspections", value: 7, unit: "count", status: "OK" },
    { metric: "inventory_variance_lines", value: 4, unit: "lines", status: "WARN" },
    { metric: "today_completed_inspections", value: 42, unit: "count", status: "OK" }
  ];
}

function shippingBacklogRows() {
  return [
    { domain: "shipping", open_count: 18, open_quantity: 126 },
    { domain: "inspection", open_count: 7, open_quantity: 39 },
    { domain: "inventory_count", open_count: 4, open_quantity: 14 },
    { domain: "returns", open_count: 2, open_quantity: 5 }
  ];
}

function shippingEventsDailyRows() {
  const rows = [];
  const now = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    rows.push({ event_date: day, event_domain: "shipping", event_type: "completed", event_count: 22 + (6 - offset) * 3 });
    rows.push({ event_date: day, event_domain: "inspection", event_type: "completed", event_count: 16 + (offset % 3) * 4 });
    rows.push({ event_date: day, event_domain: "inventory", event_type: "variance", event_count: offset % 2 === 0 ? 2 + offset : 1 });
  }
  return rows;
}

function shippingInventoryVarianceRows() {
  const now = new Date();
  return [
    {
      count_no: "CNT-20260708-001",
      count_name: "Main stock location",
      status: "OPEN",
      variance_lines: 4,
      variance_quantity: -12,
      variance_quantity_abs: 12,
      last_counted_at: new Date(now.getTime() - 18 * 60 * 1000).toISOString()
    },
    {
      count_no: "CNT-20260708-002",
      count_name: "Shipping staging",
      status: "REVIEW",
      variance_lines: 2,
      variance_quantity: 5,
      variance_quantity_abs: 5,
      last_counted_at: new Date(now.getTime() - 42 * 60 * 1000).toISOString()
    },
    {
      count_no: "CNT-20260707-006",
      count_name: "Return inspection shelf",
      status: "CLOSED",
      variance_lines: 0,
      variance_quantity: 0,
      variance_quantity_abs: 0,
      last_counted_at: new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString()
    }
  ];
}

function shippingOperationInsightRows() {
  return [
    {
      area: "Shipping",
      risk: "WARN",
      score: 68,
      summary: "Open shipments are above the normal demo threshold.",
      likely_cause: "Inspection completion is slightly behind the shipping workload.",
      recommended_action: "Prioritize shipments with completed picking and assign one operator to inspection follow-up."
    },
    {
      area: "Inventory Count",
      risk: "WARN",
      score: 61,
      summary: "Several inventory count lines still have quantity variance.",
      likely_cause: "Staging location movements and return inspection shelf updates may not be fully posted.",
      recommended_action: "Review CNT-20260708-001 and CNT-20260708-002 before closing the daily count."
    },
    {
      area: "API / DB",
      risk: "OK",
      score: 8,
      summary: "API and database health are normal in the PoC monitor.",
      likely_cause: "No connectivity issue is represented in the mock data.",
      recommended_action: "Continue monitoring health status while replacing mock endpoints with the production API."
    }
  ];
}

function shippingAlertStatusRows() {
  return [
    {
      area: "API / DB",
      status: "OK",
      severity: 0,
      message: "API and database health checks are passing.",
      owner: "Platform",
      updated_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
    },
    {
      area: "Shipping backlog",
      status: "WARN",
      severity: 2,
      message: "Open shipment workload is above demo threshold.",
      owner: "Shipping",
      updated_at: new Date(Date.now() - 11 * 60 * 1000).toISOString()
    },
    {
      area: "Inspection queue",
      status: "OK",
      severity: 1,
      message: "Pending inspections are within expected range.",
      owner: "Quality",
      updated_at: new Date(Date.now() - 14 * 60 * 1000).toISOString()
    },
    {
      area: "Inventory variance",
      status: "WARN",
      severity: 2,
      message: "Inventory count variance requires review before daily close.",
      owner: "Warehouse",
      updated_at: new Date(Date.now() - 18 * 60 * 1000).toISOString()
    }
  ];
}

async function handleApi(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-App-Access-Token"
      });
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/auth-status") {
      sendJson(res, 200, { ok: true, required: Boolean(APP_ACCESS_TOKEN), actor: requestActor(req) });
      return;
    }

    if (req.method === "GET" && req.url === "/api/ping") {
      sendJson(res, 200, { ok: true, service: "grafana-dashboard-builder", time: new Date().toISOString() });
      return;
    }

    if (isProtectedUiApi(req) && !hasValidAppAccess(req)) {
      sendJson(res, 401, {
        ok: false,
        error: "Access token is required.",
        code: "APP_ACCESS_TOKEN_REQUIRED"
      });
      return;
    }

    if (isRateLimitedApi(req)) {
      const rate = rateLimitResult(req);
      if (rate.limited) {
        res.setHeader("Retry-After", String(rate.retryAfterSeconds));
        sendJson(res, 429, {
          ok: false,
          error: `Rate limit exceeded. Try again in ${rate.retryAfterSeconds} seconds.`,
          code: "RATE_LIMIT_EXCEEDED",
          limit: rate.limit,
          retryAfterSeconds: rate.retryAfterSeconds
        });
        return;
      }
    }

    if (req.method === "GET" && req.url === "/api/runtime-status") {
      sendJson(res, 200, runtimeStatus());
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      const health = await grafana("/api/health");
      sendJson(res, 200, { ok: true, grafana: health, grafanaUrl: GRAFANA_URL });
      return;
    }

    if (req.method === "GET" && req.url === "/api/monitoring/grafana-cloud/kpis") {
      sendJson(res, 200, shippingKpiRows());
      return;
    }

    if (req.method === "GET" && req.url === "/api/monitoring/grafana-cloud/backlog") {
      sendJson(res, 200, shippingBacklogRows());
      return;
    }

    if (req.method === "GET" && req.url === "/api/monitoring/grafana-cloud/events-daily") {
      sendJson(res, 200, shippingEventsDailyRows());
      return;
    }

    if (req.method === "GET" && req.url === "/api/monitoring/grafana-cloud/inventory-count-variance") {
      sendJson(res, 200, shippingInventoryVarianceRows());
      return;
    }

    if (req.method === "GET" && req.url === "/api/monitoring/grafana-cloud/operation-insights") {
      sendJson(res, 200, shippingOperationInsightRows());
      return;
    }

    if (req.method === "GET" && req.url === "/api/monitoring/grafana-cloud/alert-status") {
      sendJson(res, 200, shippingAlertStatusRows());
      return;
    }

    if (req.method === "POST" && req.url === "/api/mobile-sensor") {
      const body = await readBody(req);
      const point = buildMobileSensorPoint(body);
      storeMobileSensorPoint(point);
      recordAppEvent("mobile_sensor_received", {
        route: "/api/mobile-sensor",
        deviceId: point.deviceId,
        message: `Sensor sample accepted. magnitude=${roundNumber(point.accelMagnitude)} shock=${point.shock}`
      });
      sendJson(res, 200, { ok: true, accepted: point });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/mobile-sensor/history")) {
      const parsed = new URL(req.url, "http://localhost");
      const rows = mobileSensorHistory(parsed.searchParams.get("limit"), parsed.searchParams.get("deviceId") || "");
      sendJson(res, 200, { ok: true, data: rows });
      return;
    }

    if (req.method === "GET" && req.url === "/api/mobile-sensor/latest") {
      const latest = Array.from(mobileSensorState.devices.values()).sort((a, b) => b.epochMs - a.epochMs);
      sendJson(res, 200, { ok: true, data: latest });
      return;
    }

    if (req.method === "GET" && req.url === "/api/mobile-sensor/metrics") {
      const body = mobileSensorPrometheusText();
      res.writeHead(200, {
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*"
      });
      res.end(body);
      return;
    }

    if (req.method === "POST" && req.url === "/api/mobile-sensor/demo-data") {
      const body = await readBody(req);
      const result = generateDemoSensorData(body);
      recordAppEvent("mobile_sensor_demo_generated", {
        route: "/api/mobile-sensor/demo-data",
        deviceId: result.deviceId,
        actor: requestActor(req),
        level: result.mode === "critical" ? "warn" : "info",
        message: `Generated ${result.count} ${result.mode} demo sensor samples. max=${result.maxMagnitude} shocks=${result.shockCount}`
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/mobile-sensor/reset") {
      const body = await readBody(req);
      const result = resetMobileSensorData(body.deviceId || "");
      recordAppEvent("mobile_sensor_reset", {
        route: "/api/mobile-sensor/reset",
        deviceId: result.deviceId,
        actor: requestActor(req),
        message: `Reset ${result.resetScope} sensor data. removedPoints=${result.removedPoints} removedDevices=${result.removedDevices}`
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "POST" && req.url === "/api/mobile-sensor/demo-scenario") {
      const body = await readBody(req);
      const result = await runDemoScenario(body);
      recordAppEvent("mobile_sensor_demo_scenario", {
        route: "/api/mobile-sensor/demo-scenario",
        deviceId: result.deviceId,
        actor: requestActor(req),
        level: result.analysis.riskLevel === "CRITICAL" ? "warn" : "info",
        message: `Scenario ${result.mode} completed. risk=${result.analysis.riskLevel} score=${result.analysis.riskScore}`
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/ai/failure-risk")) {
      const parsed = new URL(req.url, "http://localhost");
      const useAi = parsed.searchParams.get("ai") === "true";
      const analysis = await buildFailureRiskAnalysis(
        parsed.searchParams.get("deviceId") || "android-demo-001",
        parsed.searchParams.get("windowMinutes") || 10,
        useAi
      );
      recordAppEvent("ai_failure_risk_analyzed", {
        route: "/api/ai/failure-risk",
        deviceId: analysis.deviceId,
        actor: requestActor(req),
        level: analysis.riskLevel === "CRITICAL" ? "error" : analysis.riskLevel === "WARN" ? "warn" : "info",
        message: `Failure risk ${analysis.riskLevel} score=${analysis.riskScore}`
      });
      sendJson(res, 200, { ok: true, data: [analysis] });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/failure-risk") {
      const body = await readBody(req);
      const analysis = await buildFailureRiskAnalysis(
        body.deviceId || "android-demo-001",
        body.windowMinutes || 10,
        body.useAi !== false
      );
      recordAppEvent("ai_failure_risk_analyzed", {
        route: "/api/ai/failure-risk",
        deviceId: analysis.deviceId,
        actor: requestActor(req),
        level: analysis.riskLevel === "CRITICAL" ? "error" : analysis.riskLevel === "WARN" ? "warn" : "info",
        message: `Failure risk ${analysis.riskLevel} score=${analysis.riskScore}`
      });
      sendJson(res, 200, { ok: true, ...analysis });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/logs/recent")) {
      const parsed = new URL(req.url, "http://localhost");
      sendJson(res, 200, { ok: true, data: recentAppEvents(parsed.searchParams.get("limit") || 100) });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/dashboard-history")) {
      const parsed = new URL(req.url, "http://localhost");
      const limit = parsed.searchParams.get("limit") || 20;
      try {
        const rows = await firestoreDashboardHistory(limit);
        sendJson(res, 200, { ok: true, source: FIRESTORE_HISTORY_ENABLED ? "firestore" : "memory", data: rows.length ? rows : dashboardHistory(limit) });
      } catch (error) {
        recordAppEvent("dashboard_history_fallback", {
          route: "/api/dashboard-history",
          level: "warn",
          message: error.message
        });
        sendJson(res, 200, { ok: true, source: "memory", warning: error.message, data: dashboardHistory(limit) });
      }
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/ai/analyze-log")) {
      const parsed = new URL(req.url, "http://localhost");
      const useAi = parsed.searchParams.get("ai") === "true";
      const analysis = await buildLogAnalysis(parsed.searchParams.get("limit") || 100, useAi);
      recordAppEvent("ai_log_analyzed", {
        route: "/api/ai/analyze-log",
        actor: requestActor(req),
        level: analysis.riskLevel === "CRITICAL" ? "error" : analysis.riskLevel === "WARN" ? "warn" : "info",
        message: `Log analysis ${analysis.riskLevel} events=${analysis.eventCount} errors=${analysis.errorCount}`
      });
      sendJson(res, 200, { ok: true, data: [analysis] });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/analyze-log") {
      const body = await readBody(req);
      const analysis = await buildLogAnalysis(body.limit || 100, body.useAi !== false);
      recordAppEvent("ai_log_analyzed", {
        route: "/api/ai/analyze-log",
        actor: requestActor(req),
        level: analysis.riskLevel === "CRITICAL" ? "error" : analysis.riskLevel === "WARN" ? "warn" : "info",
        message: `Log analysis ${analysis.riskLevel} events=${analysis.eventCount} errors=${analysis.errorCount}`
      });
      sendJson(res, 200, { ok: true, ...analysis });
      return;
    }

    if (req.method === "GET" && req.url === "/api/folders") {
      sendJson(res, 200, { ok: true, folders: await listFolders() });
      return;
    }

    if (req.method === "GET" && req.url === "/api/datasources") {
      sendJson(res, 200, { ok: true, datasources: await listDatasources() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/propose") {
      const body = await readBody(req);
      const proposal = await hybridProposal(body.industry, body.dashboardType);
      recordAppEvent("dashboard_proposed", {
        route: "/api/propose",
        industry: proposal.industry,
        dashboardType: proposal.dashboardType,
        dashboardUid: proposal.dashboardUid,
        actor: requestActor(req),
        level: proposal.warning ? "warn" : "info",
        message: `Proposal created by ${proposal.source}`
      });
      sendJson(res, 200, proposal);
      return;
    }

    if (req.method === "POST" && req.url === "/api/datasource-replacement-plan") {
      const body = await readBody(req);
      const panels = Array.isArray(body.panels) ? body.panels : [];
      const validationErrors = validatePanelDrafts(panels);
      if (validationErrors.length) {
        sendJson(res, 400, { ok: false, error: "Panel validation failed.", errors: validationErrors });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        datasource: body.datasource || {},
        plan: datasourceReplacementPlan(panels, body.datasource || {})
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/create-dashboard") {
      const body = await readBody(req);
      const proposed = proposePanels(body.industry, body.dashboardType);
      const draftPanels = Array.isArray(body.panels) && body.panels.length ? body.panels : proposed.panels;
      const validationErrors = validatePanelDrafts(draftPanels);
      if (validationErrors.length) {
        sendJson(res, 400, { ok: false, error: "Panel validation failed.", errors: validationErrors });
        return;
      }
      const overwrite = body.overwrite === true;
      const identity = await resolveDashboardIdentity(proposed, overwrite);
      const dashboard = buildDashboard(body.industry, draftPanels, body.dashboardType);
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
      const createdEvent = recordAppEvent("dashboard_created", {
        route: "/api/create-dashboard",
        industry: proposed.industry,
        dashboardType: proposed.dashboardType,
        dashboardUid: identity.uid,
        dashboardTitle: dashboard.title,
        dashboardUrl: url,
        folderUid,
        actor: requestActor(req),
        message: `Dashboard created. overwrite=${overwrite}`
      });
      try {
        await saveDashboardHistoryToFirestore(createdEvent);
      } catch (error) {
        recordAppEvent("dashboard_history_save_failed", {
          route: "/api/create-dashboard",
          level: "warn",
          message: error.message,
          dashboardUid: identity.uid,
          dashboardUrl: url
        });
      }
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
    recordAppEvent("api_error", {
      route: req.url,
      level: "error",
      message: error.message,
      statusCode: 500
    });
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
