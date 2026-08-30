"use strict";

const MAX_PROCESS_PANELS = 13;

const broadIndustryAliases = {
  press: ["プレス加工", "打抜", "絞り加工", "stamping"],
  "heat-treatment": ["熱処理業", "焼入れ", "焼戻し", "浸炭処理"],
  plating: ["表面処理", "めっき業", "メッキ業"],
  edm: ["放電加工", "金型加工"],
  grinding: ["研削加工", "研磨加工", "鏡面仕上げ"],
  welding: ["溶接業", "製缶", "板金溶接"],
  machining: ["切削加工", "機械加工", "金属加工", "精密加工"],
  bending: ["板金加工", "曲げ加工", "ベンダー加工"],
  "special-processing": ["レーザー加工", "ウォータージェット", "積層造形"]
};

// Ranges are editable TestData demo defaults, not customer operating specifications.
const manufacturingProcessProfiles = [
  {
    key: "press",
    label: "プレス",
    slug: "press",
    processAliases: ["プレス", "press stamping"],
    equipmentAliases: ["サーボプレス", "クランクプレス", "油圧プレス"],
    equipment: ["サーボプレス", "クランクプレス", "油圧プレス"],
    applications: ["自動車部品", "端子", "精密板金"],
    monitoringTargets: ["打撃荷重ピーク", "モーター電流・消費電力", "金型温度", "カス上がり・ミスフィード", "ストローク数", "サイクルタイム"],
    panels: [
      ["Press Load Peak", "timeseries", "short", 90, 110, "ロードセルで打撃荷重ピークの変動を監視", "outside"],
      ["Press Motor Current", "timeseries", "amp", 30, 80, "プレス駆動モーターの負荷変動を監視"],
      ["Press Stroke Count", "barchart", "ops", 0, 1200, "期間別ストローク数と生産ペースを比較"],
      ["Press Power Consumption", "timeseries", "kwatt", 5, 120, "打撃サイクルごとの消費電力増加を監視"],
      ["Die Temperature", "timeseries", "celsius", 10, 100, "金型温度の上昇と熱だまりを監視"],
      ["Misfeed / Scrap Lift Events", "stat", "short", 0, 20, "カス上がりやミスフィードの検知件数を確認"],
      ["Press Cycle Time", "timeseries", "s", 10, 15, "サイクルタイムのドリフトを監視"]
    ]
  },
  {
    key: "heat-treatment",
    label: "熱処理",
    slug: "heat-treatment",
    processAliases: ["熱処理", "焼入", "焼戻", "浸炭", "焼鈍"],
    equipmentAliases: ["バッチ炉", "連続焼鈍炉", "高周波焼入機"],
    equipment: ["バッチ炉", "連続焼鈍炉", "高周波焼入機"],
    applications: ["機械部品の焼入れ・焼戻し", "浸炭"],
    monitoringTargets: ["炉内各ゾーン温度プロファイル", "雰囲気ガス濃度", "カーボンポテンシャル", "ヒーター電力", "冷却液温度・流量"],
    panels: [
      ["Furnace Zone Temperature", "timeseries", "celsius", 100, 1000, "炉内各ゾーンの温度均一性と逸脱を監視", "outside"],
      ["Atmosphere Gas Concentration", "timeseries", "percent", 0, 100, "炉内雰囲気ガス濃度の安定性を監視", "outside"],
      ["Carbon Potential", "timeseries", "short", 0, 1.5, "浸炭工程のカーボンポテンシャルを監視", "outside"],
      ["Furnace Heater Power", "timeseries", "kwatt", 0, 300, "ヒーター電力の増加と断線兆候を監視"],
      ["Quench Coolant Temperature", "timeseries", "celsius", 10, 90, "冷却液温度の上昇を監視"],
      ["Quench Coolant Flow", "timeseries", "flowlpm", 0, 500, "冷却液流量の低下を監視", "low"]
    ]
  },
  {
    key: "plating",
    label: "鍍金（めっき）",
    slug: "plating",
    processAliases: ["鍍金", "めっき", "メッキ", "アルマイト", "plating"],
    equipmentAliases: ["自動めっきライン", "バレル槽", "排水処理設備"],
    equipment: ["自動めっきライン", "バレル槽", "排水処理設備"],
    applications: ["電子接点金めっき", "防錆亜鉛", "アルマイト"],
    monitoringTargets: ["整流器電流・電圧", "積算電流量・通電時間", "液温", "pH", "導電率", "液面", "局所排気ファン・フィルター差圧"],
    panels: [
      ["Rectifier Current", "timeseries", "amp", 100, 2500, "整流器電流と通電条件の変動を監視", "outside"],
      ["Rectifier Voltage", "timeseries", "volt", 0, 30, "整流器電圧の安定性を監視", "outside"],
      ["Bath Liquid Level", "bargauge", "percent", 0, 100, "複数処理槽の液面低下を比較", "low"],
      ["Integrated Current / Plating Time", "timeseries", "short", 0, 5000, "積算電流量と通電時間を監視", "outside"],
      ["Plating Bath Temperature", "timeseries", "celsius", 10, 80, "処理槽液温の逸脱を監視", "outside"],
      ["Plating Bath pH", "timeseries", "short", 0, 14, "処理槽pHの逸脱を監視", "outside"],
      ["Bath Conductivity", "timeseries", "short", 0, 1000, "処理液の導電率変化を監視", "outside"],
      ["Exhaust Filter Differential Pressure", "timeseries", "pressurebar", 0, 1, "局所排気フィルターの目詰まりを監視"]
    ]
  },
  {
    key: "edm",
    label: "放電",
    slug: "edm",
    processAliases: ["放電", "ワイヤ放電", "形彫り放電", "edm"],
    equipmentAliases: ["ワイヤ放電加工機", "形彫り放電加工機"],
    equipment: ["ワイヤ放電加工機", "形彫り放電加工機"],
    applications: ["精密金型", "難削材", "微細加工"],
    monitoringTargets: ["放電パルス状態", "平均極間電圧", "加工液比抵抗・液温・液面・フィルター圧", "ワイヤテンション", "ワイヤ断線", "実加工時間"],
    panels: [
      ["Discharge Pulse Stability", "timeseries", "percent", 0, 100, "放電パルスの安定率を監視", "low"],
      ["Average Gap Voltage", "timeseries", "volt", 0, 150, "平均極間電圧の逸脱を監視", "outside"],
      ["Dielectric Fluid Resistivity", "timeseries", "short", 0, 100, "加工液比抵抗の変化を監視", "outside"],
      ["Dielectric Fluid Temperature", "timeseries", "celsius", 10, 50, "加工液温度の上昇を監視"],
      ["Dielectric Fluid Level", "gauge", "percent", 0, 100, "加工液液面の低下を監視", "low"],
      ["EDM Filter Pressure", "timeseries", "pressurebar", 0, 5, "加工液フィルター圧の上昇を監視"],
      ["Wire Tension", "timeseries", "short", 0, 30, "ワイヤテンションの逸脱を監視", "outside"],
      ["Wire Break Count", "stat", "short", 0, 20, "ワイヤ断線件数を確認"],
      ["EDM Actual Machining Time", "timeseries", "s", 0, 3600, "実加工時間と空転時間を監視"]
    ]
  },
  {
    key: "grinding",
    label: "研磨",
    slug: "grinding",
    processAliases: ["研磨", "研削", "ラップ", "バフ", "grinding", "polishing"],
    equipmentAliases: ["平面研削盤", "円筒研削盤", "ラップ機", "バフ機"],
    equipment: ["平面研削盤", "円筒研削盤", "ラップ・バフ機"],
    applications: ["シャフト", "光学治具", "鏡面仕上げ"],
    monitoringTargets: ["主軸モーター負荷電流", "主軸ベアリング振動", "クーラント吐出圧・液温", "砥石摩耗", "ドレッシング周期"],
    panels: [
      ["Grinding Spindle Current", "timeseries", "amp", 5, 100, "過負荷と空研削を主軸電流から監視"],
      ["Spindle Bearing Vibration", "heatmap", "accMS2", 0.01, 0.2, "主軸ベアリング振動の時間帯別分布を監視"],
      ["Coolant Discharge Pressure", "timeseries", "pressurebar", 0, 10, "クーラント吐出圧の低下を監視", "low"],
      ["Grinding Coolant Temperature", "timeseries", "celsius", 10, 50, "クーラント液温の上昇を監視"],
      ["Grinding Wheel Wear", "gauge", "percent", 0, 100, "砥石摩耗の進行を監視"],
      ["Dressing Cycle Count", "barchart", "ops", 0, 500, "期間別のドレッシング実施回数を比較"]
    ]
  },
  {
    key: "welding",
    label: "溶接",
    slug: "welding",
    processAliases: ["溶接", "tig", "mig", "mag", "welding"],
    equipmentAliases: ["TIG溶接機", "MIG溶接機", "MAG溶接機", "レーザー溶接機", "溶接ロボット"],
    equipment: ["TIG/MIG/MAG溶接機", "レーザー溶接機", "溶接ロボット"],
    applications: ["フレーム製缶", "精密板金接合"],
    monitoringTargets: ["溶接電流・電圧波形", "入熱量", "シールドガス残圧・流量", "ワイヤ送給速度", "スポット溶接加圧力"],
    panels: [
      ["Welding Current", "timeseries", "amp", 20, 500, "溶接電流波形のばらつきを監視", "outside"],
      ["Welding Voltage", "timeseries", "volt", 0, 50, "溶接電圧波形のばらつきを監視", "outside"],
      ["Welding Heat Input", "timeseries", "short", 0, 100, "電流・電圧から入熱量の変化を監視", "outside"],
      ["Shield Gas Pressure", "gauge", "pressurebar", 0, 20, "シールドガス残圧の低下を監視", "low"],
      ["Shield Gas Flow", "timeseries", "flowlpm", 0, 50, "シールドガス流量の低下を監視", "low"],
      ["Wire Feed Speed", "timeseries", "velocityms", 0, 30, "ワイヤ送給速度の逸脱を監視", "outside"],
      ["Spot Welding Force", "timeseries", "short", 0, 1000, "スポット溶接加圧力の逸脱を監視", "outside"]
    ]
  },
  {
    key: "machining",
    label: "切削",
    slug: "machining",
    processAliases: ["切削", "旋盤", "マシニング", "machining", "cnc"],
    equipmentAliases: ["マシニングセンタ", "マシニングセンター", "NC旋盤", "CNC旋盤", "複合旋盤", "複合機"],
    equipment: ["5軸・立型マシニングセンタ", "CNC旋盤", "複合機"],
    applications: ["試作部品", "航空宇宙・ロボット向けSUS/アルミ加工"],
    monitoringTargets: ["主軸負荷トルク・電流", "主軸振動", "主軸温度変位", "クーラント液面・濃度", "CNC稼働状態・アラーム"],
    panels: [
      ["Spindle Load Torque", "timeseries", "percent", 0, 100, "刃具摩耗や欠損兆候を主軸負荷から監視"],
      ["Machining Spindle Current", "timeseries", "amp", 5, 120, "切削負荷の増加を主軸電流から監視"],
      ["Machining Spindle Vibration", "timeseries", "accMS2", 0.01, 0.2, "工具・主軸系の振動増加を監視"],
      ["Spindle Temperature", "timeseries", "celsius", 10, 80, "主軸温度上昇を監視"],
      ["Spindle Thermal Displacement", "timeseries", "short", -50, 50, "主軸温度変位の許容帯逸脱を監視", "outside"],
      ["Machining Coolant Level", "gauge", "percent", 0, 100, "クーラント液面低下を監視", "low"],
      ["Coolant Concentration", "timeseries", "percent", 0, 20, "クーラント濃度の許容帯逸脱を監視", "outside"],
      ["CNC Alarm Count", "stat", "short", 0, 20, "NCコード実行中のアラーム件数を確認"]
    ]
  },
  {
    key: "bending",
    label: "曲げ",
    slug: "bending",
    processAliases: ["曲げ", "ベンディング", "bending"],
    equipmentAliases: ["NCプレスブレーキ", "プレスブレーキ", "パイプベンダー"],
    equipment: ["NCプレスブレーキ", "パイプベンダー"],
    applications: ["筐体", "制御盤カバー", "ブラケット"],
    monitoringTargets: ["加圧力トン数波形", "作動油温・圧力", "バックゲージ位置決め", "サイクルタイム", "段取り時間"],
    panels: [
      ["Bending Force", "timeseries", "short", 20, 200, "加圧力トン数波形の逸脱を監視", "outside"],
      ["Hydraulic Oil Temperature", "timeseries", "celsius", 10, 80, "油圧ユニット作動油温の上昇を監視"],
      ["Hydraulic Pressure", "timeseries", "pressurebar", 0, 300, "油圧ユニット圧力の逸脱を監視", "outside"],
      ["Backgauge Position Deviation", "timeseries", "short", -5, 5, "バックゲージ位置決め偏差を監視", "outside"],
      ["Bending Cycle Time", "timeseries", "s", 5, 120, "位置決めから曲げ完了までのサイクルを監視"],
      ["Bending Setup Time", "timeseries", "s", 0, 1800, "段取り時間の長期化を監視"]
    ]
  },
  {
    key: "special-processing",
    label: "特殊加工",
    slug: "special-processing",
    processAliases: ["特殊加工", "ファイバーレーザー", "ウォータージェット", "金属3dプリンター", "積層造形"],
    equipmentAliases: ["ファイバーレーザー加工機", "ウォータージェット", "金属3Dプリンター"],
    equipment: ["ファイバーレーザー加工機", "ウォータージェット", "金属3Dプリンター"],
    applications: ["精密板金切断", "特殊形状積層"],
    monitoringTargets: ["レーザー発振出力", "反射光強度", "アシストガス圧力・消費量", "高圧ポンプ水圧", "チャンバー内酸素濃度"],
    panels: [
      ["Laser Oscillator Output", "timeseries", "kwatt", 0, 20, "レーザー発振出力の逸脱を監視", "outside"],
      ["Reflected Light Intensity", "timeseries", "percent", 0, 100, "反射光増加による加工不安定を監視"],
      ["Assist Gas Pressure", "timeseries", "pressurebar", 0, 30, "窒素・酸素アシストガス圧力低下を監視", "low"],
      ["Assist Gas Consumption", "timeseries", "flowlpm", 0, 500, "アシストガス消費量の増加を監視"],
      ["Waterjet Pump Pressure", "timeseries", "pressurebar", 0, 6000, "高圧ポンプ水圧の逸脱を監視", "outside"],
      ["Chamber Oxygen Concentration", "timeseries", "percent", 0, 25, "金属3Dプリンターのチャンバー内酸素濃度上昇を監視"]
    ]
  }
];

function includesAlias(values, aliases) {
  const corpus = (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").toLowerCase())
    .join("\n");
  return aliases.some((alias) => corpus.includes(alias.toLowerCase()));
}

function normalizeSelection(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((item) => String(item)) : [];
}

function processInput(value, options = {}) {
  const analysis = value && typeof value === "object" ? value : {};
  const industry = typeof value === "string" ? value : options.industry || analysis.industrySummary || "";
  return {
    industry: String(industry || ""),
    processes: normalizeSelection(analysis.processes),
    equipment: [
      ...normalizeSelection(analysis.equipment),
      ...normalizeSelection(options.selectedEquipment)
    ]
  };
}

function findManufacturingProcessProfiles(value, options = {}) {
  const input = processInput(value, options);
  const processValues = [input.industry, ...input.processes];
  const equipmentValues = input.equipment;
  const pressBrakeOnly = includesAlias([...processValues, ...equipmentValues], ["プレスブレーキ", "press brake"]);
  return manufacturingProcessProfiles.filter((profile) => {
    const equipmentMatch = includesAlias(equipmentValues, profile.equipmentAliases);
    const explicitProcessMatch = includesAlias(input.processes, profile.processAliases);
    const industryMatch = includesAlias([input.industry], [
      ...profile.processAliases,
      ...profile.equipmentAliases,
      ...(broadIndustryAliases[profile.key] || [])
    ]);
    if (profile.key === "press" && pressBrakeOnly && !explicitProcessMatch && !equipmentMatch) return false;
    return equipmentMatch || explicitProcessMatch || industryMatch;
  });
}

function panelObject(profile, tuple, selectedEquipment) {
  const [title, visualization, unit, min, max, purpose, riskDirection] = tuple;
  const matchingEquipment = normalizeSelection(selectedEquipment).filter((equipment) =>
    includesAlias([equipment], profile.equipmentAliases)
  );
  const equipment = matchingEquipment.length ? matchingEquipment : profile.equipment;
  return {
    title,
    visualization,
    unit,
    min,
    max,
    purpose,
    riskDirection,
    latestOnly: visualization === "stat" || visualization === "gauge" || visualization === "bargauge",
    proposalSource: "process-catalog",
    rangeSource: "testdata-demo-default",
    processKey: profile.key,
    processLabel: profile.label,
    equipment,
    rationale: `${profile.label}工程の代表的な監視対象「${purpose}」として採用`
  };
}

function selectBalancedPanels(profiles, limit = MAX_PROCESS_PANELS, options = {}) {
  const primaryProcess = String(options.primaryProcess || "");
  const ordered = [...profiles].sort((left, right) => {
    if (left.key === primaryProcess) return -1;
    if (right.key === primaryProcess) return 1;
    return 0;
  });
  const selected = [];
  for (const profile of ordered) {
    if (selected.length >= limit) break;
    if (profile.panels[0]) selected.push(panelObject(profile, profile.panels[0], options.selectedEquipment));
  }
  const primary = ordered.find((profile) => profile.key === primaryProcess);
  if (primary) {
    for (let panelIndex = 1; panelIndex < Math.min(5, primary.panels.length) && selected.length < limit; panelIndex += 1) {
      selected.push(panelObject(primary, primary.panels[panelIndex], options.selectedEquipment));
    }
  }
  for (let panelIndex = 1; selected.length < limit; panelIndex += 1) {
    let added = false;
    for (const profile of ordered) {
      if (selected.length >= limit) break;
      if (profile.key !== primaryProcess && panelIndex < Math.min(3, profile.panels.length) && profile.panels[panelIndex]) {
        selected.push(panelObject(profile, profile.panels[panelIndex], options.selectedEquipment));
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

function buildManufacturingProcessProfile(value, options = {}) {
  let matches = findManufacturingProcessProfiles(value, options);
  if (options.primaryProcess) {
    const primary = manufacturingProcessProfiles.find((profile) => profile.key === options.primaryProcess);
    if (primary && !matches.some((profile) => profile.key === primary.key)) matches = [primary, ...matches];
  }
  const selectedEquipment = normalizeSelection(options.selectedEquipment);
  if (selectedEquipment.length) {
    const equipmentMatches = matches.filter((profile) => includesAlias(selectedEquipment, profile.equipmentAliases));
    if (equipmentMatches.length) matches = equipmentMatches;
  }
  if (!matches.length) return null;
  return {
    slug: matches.slice(0, 2).map((profile) => profile.slug).join("-"),
    focus: `${matches.map((profile) => profile.label).join("・")}工程`,
    panels: selectBalancedPanels(matches, MAX_PROCESS_PANELS, options),
    matchedProcesses: matches.map((profile) => profile.key),
    processOptions: matches.map((profile) => ({ key: profile.key, label: profile.label })),
    equipmentOptions: [...new Set(matches.flatMap((profile) => profile.equipment))]
  };
}

function buildManufacturingProcessReference(analysis) {
  const matches = findManufacturingProcessProfiles(analysis);
  if (!matches.length) return "";
  const lines = [
    "工程別監視候補（一般的な参考情報であり、個社の確認済み仕様ではない）:"
  ];
  for (const profile of matches) {
    lines.push(`- ${profile.label}`);
    lines.push(`  代表設備: ${profile.equipment.join("、")}`);
    lines.push(`  主な用途: ${profile.applications.join("、")}`);
    lines.push(`  監視候補: ${profile.monitoringTargets.join("、")}`);
  }
  lines.push("資料で確認できない設備・信号・正常範囲は仮説として扱い、TestDataの範囲は編集可能なデモ値として提示すること。");
  return lines.join("\n");
}

module.exports = {
  MAX_PROCESS_PANELS,
  manufacturingProcessProfiles,
  broadIndustryAliases,
  findManufacturingProcessProfiles,
  selectBalancedPanels,
  buildManufacturingProcessProfile,
  buildManufacturingProcessReference
};
