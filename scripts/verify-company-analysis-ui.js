const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const htmlPath = path.join(repoRoot, "public", "grafana-sales-dashboard-builder.html");
const serverPath = path.join(repoRoot, "server", "grafana-dashboard-builder.js");
const failures = [];
let passed = 0;

function record(condition, message) {
  if (condition) {
    passed += 1;
    return;
  }
  failures.push(message);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRequiredFile(filePath, description) {
  if (!fs.existsSync(filePath)) {
    failures.push(`${description} is missing: ${filePath}`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function startTagById(html, id) {
  const escapedId = escapeRegex(id);
  const pattern = new RegExp(
    `<([a-zA-Z][\\w:-]*)\\b[^>]*\\bid\\s*=\\s*(["'])${escapedId}\\2[^>]*>`,
    "i"
  );
  const match = html.match(pattern);
  if (!match) return null;
  return { tagName: match[1].toLowerCase(), source: match[0], index: match.index };
}

function attribute(tag, name) {
  if (!tag) return null;
  const escapedName = escapeRegex(name);
  const quoted = tag.source.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (quoted) return quoted[2];
  const unquoted = tag.source.match(new RegExp(`\\b${escapedName}\\s*=\\s*([^\\s>]+)`, "i"));
  return unquoted ? unquoted[1] : null;
}

function allIds(html) {
  const ids = [];
  const pattern = /\bid\s*=\s*(["'])(.*?)\1/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    // Ignore JavaScript template placeholders; only literal HTML ids can be
    // evaluated for uniqueness by this dependency-free source check.
    if (/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(match[2])) ids.push(match[2]);
  }
  return ids;
}

function hasAccessibleName(html, tag, id) {
  if (!tag) return false;
  if ((attribute(tag, "aria-label") || "").trim()) return true;

  const labelledBy = (attribute(tag, "aria-labelledby") || "").trim().split(/\s+/).filter(Boolean);
  if (labelledBy.length && labelledBy.every((labelId) => startTagById(html, labelId))) return true;

  const escapedId = escapeRegex(id);
  const explicitLabel = new RegExp(
    `<label\\b[^>]*\\bfor\\s*=\\s*(["'])${escapedId}\\1[^>]*>[\\s\\S]*?<\\/label>`,
    "i"
  );
  if (explicitLabel.test(html)) return true;

  const wrappingLabel = new RegExp(
    `<label\\b[^>]*>[\\s\\S]*?<${tag.tagName}\\b[^>]*\\bid\\s*=\\s*(["'])${escapedId}\\1[^>]*>[\\s\\S]*?<\\/label>`,
    "i"
  );
  return wrappingLabel.test(html);
}

const html = readRequiredFile(htmlPath, "Dashboard builder HTML");
const server = readRequiredFile(serverPath, "Dashboard builder server");

if (html) {
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  let scriptsParse = true;
  let scriptParseError = "";
  for (const match of inlineScripts) {
    try {
      new Function(match[1]);
    } catch (error) {
      scriptsParse = false;
      scriptParseError = error.message;
      break;
    }
  }
  record(scriptsParse, `Inline dashboard builder JavaScript must parse: ${scriptParseError}`);

  const requiredElements = [
    ["industrySourceTab", "button"],
    ["companySourceTab", "button"],
    ["industrySourcePanel", null],
    ["companySourcePanel", null],
    ["companyUrl", null],
    ["companyKeywords", null],
    ["companyNotes", null],
    ["companyMaterials", "input"],
    ["companyAiConsent", "input"],
    ["analyzeCompanySources", "button"],
    ["companyMaterialList", null],
    ["companyAnalysisResult", null],
    ["applyCompanyAnalysis", "button"],
    ["monitoringGoal", "select"],
    ["primaryProcess", "select"],
    ["equipmentSelector", "fieldset"],
    ["equipmentOptions", null],
    ["proposalSourceSummary", null],
    ["dialogPanelProposalInfo", null]
  ];

  const elements = new Map();
  for (const [id, expectedTag] of requiredElements) {
    const tag = startTagById(html, id);
    elements.set(id, tag);
    record(Boolean(tag), `Missing required UI element #${id}.`);
    if (tag && expectedTag) {
      record(tag.tagName === expectedTag, `#${id} must be a <${expectedTag}>; found <${tag.tagName}>.`);
    }
  }

  const ids = allIds(html);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  record(duplicateIds.length === 0, `Duplicate HTML id values found: ${duplicateIds.join(", ")}.`);

  const labelledControls = [
    "companyUrl",
    "companyKeywords",
    "companyNotes",
    "companyMaterials",
    "companyAiConsent",
    "analyzeCompanySources",
    "applyCompanyAnalysis",
    "monitoringGoal",
    "primaryProcess"
  ];
  for (const id of labelledControls) {
    const tag = elements.get(id);
    if (tag) {
      record(
        hasAccessibleName(html, tag, id),
        `#${id} needs an accessible name using <label for="${id}">, aria-label, or aria-labelledby.`
      );
    }
  }

  const materials = elements.get("companyMaterials");
  if (materials) {
    record(
      (attribute(materials, "type") || "").toLowerCase() === "file",
      "#companyMaterials must be an <input type=\"file\"> so fixture images and company materials can be selected."
    );
  }

  const consent = elements.get("companyAiConsent");
  if (consent) {
    record(
      (attribute(consent, "type") || "").toLowerCase() === "checkbox",
      "#companyAiConsent must be a checkbox."
    );
    record(
      /aiConsent\s*:\s*true/.test(html),
      "Company analysis requests must send explicit AI consent to the API."
    );
  }

  const tabContracts = [
    ["industrySourceTab", "industrySourcePanel"],
    ["companySourceTab", "companySourcePanel"]
  ];
  const selectedStates = [];
  for (const [tabId, panelId] of tabContracts) {
    const tab = elements.get(tabId);
    const panel = elements.get(panelId);
    if (tab) {
      record(attribute(tab, "role") === "tab", `#${tabId} must have role="tab".`);
      const selected = attribute(tab, "aria-selected");
      record(selected === "true" || selected === "false", `#${tabId} must set aria-selected to "true" or "false".`);
      if (selected === "true" || selected === "false") selectedStates.push(selected);
      record(attribute(tab, "aria-controls") === panelId, `#${tabId} must have aria-controls="${panelId}".`);
    }
    if (panel) {
      record(attribute(panel, "role") === "tabpanel", `#${panelId} must have role="tabpanel".`);
      record(attribute(panel, "aria-labelledby") === tabId, `#${panelId} must have aria-labelledby="${tabId}".`);
    }
  }
  if (selectedStates.length === 2) {
    record(
      selectedStates.filter((state) => state === "true").length === 1,
      "Exactly one source tab must initially have aria-selected=" + '"true".'
    );
  }

  record(
    /["'`]\/api\/analyze-company-sources["'`]/.test(html),
    "Client UI must call /api/analyze-company-sources when company sources are analyzed."
  );
  record(
    /companySourceTab[\s\S]{0,1200}(addEventListener|onclick)|(?:addEventListener|onclick)[\s\S]{0,1200}companySourceTab/.test(html),
    "Company source tab needs a click handler that switches the visible input panel."
  );
  record(
    /analyzeCompanySources[\s\S]{0,1600}(addEventListener|onclick)|(?:addEventListener|onclick)[\s\S]{0,1600}analyzeCompanySources/.test(html),
    "#analyzeCompanySources needs an interaction handler for the analysis request."
  );
  record(
    /applyCompanyAnalysis[\s\S]{0,1600}(addEventListener|onclick)|(?:addEventListener|onclick)[\s\S]{0,1600}applyCompanyAnalysis/.test(html),
    "#applyCompanyAnalysis needs an interaction handler that applies the reviewed analysis to panel proposals."
  );
  record(/monitoringGoal\s*:\s*\$\("monitoringGoal"\)\.value/.test(html), "Proposal requests must include monitoringGoal.");
  record(/selectedEquipment\s*:\s*selectedEquipmentValues\(\)/.test(html), "Proposal requests must include selected equipment.");
  record(/proposalSourceLabel\(proposal\.source\)/.test(html), "Proposal source must remain visible with a human-readable label.");
  record(/TestDataデモ範囲/.test(html), "UI must distinguish TestData demo ranges from customer-confirmed settings.");
  record(/採用理由/.test(html), "UI must show a rationale for each proposed panel.");
}

if (server) {
  record(
    /req\.method\s*===\s*["']POST["'][\s\S]{0,240}req\.url\s*===\s*["']\/api\/analyze-company-sources["']|req\.url\s*===\s*["']\/api\/analyze-company-sources["'][\s\S]{0,240}req\.method\s*===\s*["']POST["']/.test(server),
    "Server must define POST /api/analyze-company-sources in its API request handler."
  );
}

const total = passed + failures.length;
if (failures.length) {
  console.error(`[company-analysis-ui] FAILED: ${failures.length} of ${total} checks failed.`);
  failures.forEach((message, index) => console.error(`  ${index + 1}. ${message}`));
  process.exitCode = 1;
} else {
  console.log(`[company-analysis-ui] OK: ${passed} contract checks passed.`);
}
