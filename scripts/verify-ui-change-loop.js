const http = require("http");
const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const port = Number(process.env.UI_VERIFY_PORT || process.env.PORT || 4173);
const host = process.env.UI_VERIFY_HOST || "127.0.0.1";
const targetPath = process.env.UI_VERIFY_PATH || "/";
const targetUrl = `http://${host}:${port}${targetPath}`;
const maxRetries = Number(process.env.UI_VERIFY_MAX_RETRIES || 2);
const serverReadyTimeoutMs = Number(process.env.UI_VERIFY_SERVER_TIMEOUT_MS || 20000);
const browserTimeoutMs = Number(process.env.UI_VERIFY_BROWSER_TIMEOUT_MS || 30000);
const outputDir = path.join(repoRoot, "outputs", "ui-verification");

const relatedTests = [
  ["node", ["--check", "server/grafana-dashboard-builder.js"]],
  ["node", ["--check", "scripts/verify-ui-change-loop.js"]],
  ["node", ["scripts/verify-risk-direction.js"]],
  ["node", ["scripts/verify-panel-layout.js"]],
  ["node", ["scripts/verify-manufacturing-process-profiles.js"]],
  ["node", ["scripts/verify-dashboard-proposal-composition.js"]],
  ["node", ["scripts/verify-extended-visualizations.js"]],
  ["node", ["scripts/verify-company-analysis-ui.js"]],
  ["node", ["scripts/verify-relative-testdata-time.js"]],
  ["node", ["scripts/verify-google-oidc-mode.js"]],
  ["node", ["scripts/verify-auth-fail-closed.js"]],
  ["node", ["scripts/verify-static-dashboard-import-policy.js"]],
  ["node", ["scripts/verify-api-safety.js"]],
  ["node", ["scripts/verify-persistent-idempotency.js"]],
  ["node", ["scripts/verify-immutable-cloud-run-release.js"]],
  ["node", ["scripts/verify-firestore-sensor-persistence.js"]],
  ["node", ["scripts/verify-service-role-separation.js"]],
  ["node", ["scripts/validate-repository.js"]]
];

function log(message) {
  console.log(`[ui-loop] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: options.method || "GET" }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`${url}: invalid JSON: ${error.message}`));
          }
        });
      });
    request.on("error", reject);
    request.end();
  });
}

function requestApiJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? "" : JSON.stringify(options.body);
    const request = http.request(url, {
      method: options.method || "GET",
      headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}
    }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode || 0, data: JSON.parse(responseBody) });
        } catch (error) {
          reject(new Error(`${url}: invalid JSON: ${error.message}`));
        }
      });
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      })
      .on("error", reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.CHROME_BIN,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  fail("Chrome or Edge was not found. Set CHROME_PATH to a Chromium-based browser.");
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = address && typeof address === "object" ? address.port : 0;
      server.close(() => resolve(selected));
    });
    server.on("error", reject);
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      shell: false,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with code ${code}\n${stdout}\n${stderr}`));
      }
    });
  });
}

async function killProcess(child) {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    child.once("close", resolve);
    child.kill();
    setTimeout(resolve, 3000);
  });
}

async function removeDirWithRetry(dir) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        log(`Warning: could not remove temporary browser profile: ${dir}: ${error.message}`);
        return;
      }
      await wait(500);
    }
  }
}

function startDevServer() {
  const child = spawn("node", ["server/grafana-dashboard-builder.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
      APP_ACCESS_TOKEN: "",
      DASHBOARD_BUILDER_ACCESS_TOKEN: "",
      GRAFANA_SERVICE_ACCOUNT_TOKEN: "",
      GRAFANA_CLOUD_TOKEN: "",
      FIRESTORE_HISTORY_ENABLED: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[dev-server] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[dev-server] ${chunk}`));
  return child;
}

async function waitForServer() {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < serverReadyTimeoutMs) {
    try {
      const response = await requestText(targetUrl);
      if (response.statusCode >= 200 && response.statusCode < 400) return response;
      lastError = `HTTP ${response.statusCode}`;
    } catch (error) {
      lastError = error.message;
    }
    await wait(500);
  }
  fail(`Dev server did not become ready at ${targetUrl}: ${lastError}`);
}

async function verifyLocalApi() {
  const ping = await requestApiJson(`http://${host}:${port}/api/ping`);
  if (ping.statusCode !== 200 || ping.data?.ok !== true || ping.data?.service !== "grafana-dashboard-builder") {
    fail(`Local API ping failed: ${JSON.stringify(ping)}`);
  }
  const proposal = await requestApiJson(`http://${host}:${port}/api/propose`, {
    method: "POST",
    body: { industry: "板金加工業者", dashboardType: "manufacturing" }
  });
  if (proposal.statusCode !== 200 || proposal.data?.source !== "process-catalog" || proposal.data?.panels?.length < 7) {
    fail(`Known-industry proposal API failed: ${JSON.stringify(proposal)}`);
  }
  log(`Local API OK: ping=200, proposalPanels=${proposal.data.panels.length}`);
  return { pingStatus: ping.statusCode, proposalPanels: proposal.data.panels.length };
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const client = new CdpClient(ws);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (event) => client.onMessage(event));
    return client;
  }

  onMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    if (message.method && this.listeners.has(message.method)) {
      for (const listener of this.listeners.get(message.method)) listener(message.params || {});
    }
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, browserTimeoutMs);
    });
  }

  close() {
    this.ws.close();
  }
}

async function evaluate(client, expression) {
  const evaluation = await client.send("Runtime.evaluate", {
    returnByValue: true,
    awaitPromise: true,
    expression
  });
  if (evaluation.exceptionDetails) {
    fail(`Browser evaluation failed: ${evaluation.exceptionDetails.text || "unknown exception"}`);
  }
  return evaluation.result?.value;
}

async function waitForBrowserCondition(client, expression, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < browserTimeoutMs) {
    if (await evaluate(client, expression)) return;
    await wait(250);
  }
  fail(`Timed out waiting for browser condition: ${label}`);
}

async function captureScreenshot(client, filename) {
  fs.mkdirSync(outputDir, { recursive: true });
  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true
  });
  const screenshotPath = path.join(outputDir, filename);
  fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  return screenshotPath;
}

async function verifyBrowser(apiEvidence) {
  const chromePath = findChrome();
  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grafana-ui-verify-"));
  const chromeArgs = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ];
  if (process.env.CI) chromeArgs.splice(2, 0, "--no-sandbox");
  log(`Browser ready for verification: ${chromePath}`);
  const chrome = spawn(chromePath, chromeArgs, { stdio: ["ignore", "ignore", "ignore"] });

  try {
    let version;
    const startedAt = Date.now();
    while (Date.now() - startedAt < browserTimeoutMs) {
      try {
        version = await requestJson(`http://127.0.0.1:${debugPort}/json/version`);
        break;
      } catch {
        await wait(300);
      }
    }
    if (!version) fail("Browser DevTools endpoint did not start.");

    const pageTarget = await requestJson(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`, {
      method: "PUT"
    });
    const client = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    const consoleErrors = [];
    const exceptions = [];

    client.on("Runtime.consoleAPICalled", (params) => {
      if (params.type === "error" || params.type === "assert") {
        const text = (params.args || []).map((arg) => arg.value || arg.description || "").join(" ");
        consoleErrors.push(text || params.type);
      }
    });
    client.on("Runtime.exceptionThrown", (params) => {
      exceptions.push(params.exceptionDetails?.text || "Runtime exception");
    });

    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false
    });
    await client.send("Page.navigate", { url: targetUrl });
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, browserTimeoutMs);
      client.on("Page.loadEventFired", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await wait(1000);

    const initialState = await evaluate(client, `(() => ({
        title: document.title,
        h1: document.querySelector("h1")?.innerText || "",
        hasIndustry: Boolean(document.querySelector("#industry")),
        hasDashboardType: Boolean(document.querySelector("#dashboardType")),
        hasMonitoringGoal: Boolean(document.querySelector("#monitoringGoal")),
        hasPrimaryProcess: Boolean(document.querySelector("#primaryProcess")),
        hasEquipmentSelector: Boolean(document.querySelector("#equipmentSelector")),
        hasProposalSourceSummary: Boolean(document.querySelector("#proposalSourceSummary")),
        hasPropose: Boolean(document.querySelector("#propose")),
        hasCreate: Boolean(document.querySelector("#create")),
        hasDiscardDraft: Boolean(document.querySelector("#discardDraft")),
        hasDraftState: Boolean(document.querySelector("#draftState")),
        hasPanelFilter: Boolean(document.querySelector("#panelFilter")),
        hasAccessCodeSection: Boolean(document.querySelector("#accessCodeSection")),
        hasGoogleSignInSection: Boolean(document.querySelector("#googleSignInSection")),
        hasAuthState: Boolean(document.querySelector("#authState")),
        hasPreviewModeTab: Boolean(document.querySelector("#previewModeTab")),
        hasListModeTab: Boolean(document.querySelector("#listModeTab")),
        hasPanelDialog: Boolean(document.querySelector("#panelEditorDialog")),
        hasGridStack: typeof window.GridStack?.init === "function",
        workflowStepCount: document.querySelectorAll("#workflowSteps [data-step]").length,
        toolSectionCount: document.querySelectorAll("details.tool-section").length,
        openToolSectionCount: document.querySelectorAll("details.tool-section[open]").length,
        bodyText: document.body.innerText.slice(0, 500)
      }))()`) || {};

    if (initialState.title !== "Grafana Cloud ダッシュボード提案ツール") {
      fail(`Unexpected page title: ${initialState.title}`);
    }
    if (!String(initialState.h1).includes("Grafana Cloud")) fail("Target screen h1 was not rendered.");
    if (!initialState.hasIndustry || !initialState.hasDashboardType || !initialState.hasMonitoringGoal || !initialState.hasPrimaryProcess || !initialState.hasEquipmentSelector || !initialState.hasProposalSourceSummary || !initialState.hasPropose || !initialState.hasCreate || !initialState.hasDiscardDraft || !initialState.hasDraftState || !initialState.hasPanelFilter || !initialState.hasAccessCodeSection || !initialState.hasGoogleSignInSection || !initialState.hasAuthState || !initialState.hasPreviewModeTab || !initialState.hasListModeTab || !initialState.hasPanelDialog || !initialState.hasGridStack) {
      fail(`Target screen required controls missing: ${JSON.stringify(initialState)}`);
    }
    if (initialState.workflowStepCount !== 3) fail(`Expected 3 workflow steps, found ${initialState.workflowStepCount}.`);
    if (initialState.toolSectionCount < 6) fail(`Expected at least 6 collapsible tool sections, found ${initialState.toolSectionCount}.`);
    if (initialState.openToolSectionCount > 1) fail("Auxiliary tool sections must be collapsed except the creation history section.");

    const oidcUiState = await evaluate(client, `(() => {
      const original = {
        authMode: state.authMode,
        authenticated: state.authenticated,
        authActor: state.authActor,
        googleOidcClientId: state.googleOidcClientId
      };
      state.authMode = "google-oidc";
      state.authenticated = false;
      state.authActor = "";
      state.googleOidcClientId = "test-client.apps.googleusercontent.com";
      renderAuthState();
      const googleMode = {
        accessCodeHidden: document.querySelector("#accessCodeSection").hidden,
        googleVisible: !document.querySelector("#googleSignInSection").hidden,
        authText: document.querySelector("#authState").textContent,
        signOutHidden: document.querySelector("#googleSignOut").hidden
      };
      state.authMode = "iap";
      state.authenticated = true;
      state.authActor = "y.tsutsumi30@gmail.com";
      renderAuthState();
      const iapMode = {
        accessCodeHidden: document.querySelector("#accessCodeSection").hidden,
        googleHidden: document.querySelector("#googleSignInSection").hidden,
        authText: document.querySelector("#authState").textContent
      };
      Object.assign(state, original);
      renderAuthState();
      return { googleMode, iapMode };
    })()`);
    if (!oidcUiState?.googleMode.accessCodeHidden ||
        !oidcUiState.googleMode.googleVisible ||
        !oidcUiState.googleMode.authText.includes("Googleでログイン") ||
        !oidcUiState.googleMode.signOutHidden ||
        !oidcUiState.iapMode.accessCodeHidden ||
        !oidcUiState.iapMode.googleHidden ||
        !oidcUiState.iapMode.authText.includes("y.tsutsumi30@gmail.com")) {
      fail(`OIDC UI mode check failed: ${JSON.stringify(oidcUiState)}`);
    }

    const authFailureState = await evaluate(client, `(async () => {
      const originalFetch = window.fetch;
      const originalGoogle = window.google;
      const original = {
        authMode: state.authMode,
        authenticated: state.authenticated,
        authActor: state.authActor,
        googleOidcClientId: state.googleOidcClientId,
        googleOidcCredential: state.googleOidcCredential
      };
      window.google = { accounts: { id: {
        initialize() {},
        renderButton() {},
        disableAutoSelect() {}
      } } };
      state.authMode = "google-oidc";
      state.authenticated = true;
      state.authActor = "test@example.com";
      state.googleOidcClientId = "test-client.apps.googleusercontent.com";
      state.googleOidcCredential = "expired-token";
      window.fetch = async () => new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
      let expiredMessage = "";
      try {
        await requestApi("/api/test-auth-expiry");
      } catch (error) {
        expiredMessage = error.message;
      }
      const expired = {
        expiredMessage,
        authenticated: state.authenticated,
        credentialCleared: state.googleOidcCredential === "",
        authText: document.querySelector("#authState").textContent
      };
      window.fetch = async () => { throw new TypeError("offline"); };
      await loadAuthStatus();
      const unavailable = {
        mode: state.authMode,
        authenticated: state.authenticated,
        authText: document.querySelector("#authState").textContent
      };
      window.fetch = originalFetch;
      if (originalGoogle === undefined) delete window.google;
      else window.google = originalGoogle;
      Object.assign(state, original);
      renderAuthState();
      return { expired, unavailable };
    })()`);
    if (!authFailureState?.expired.expiredMessage.includes("再ログイン") ||
        authFailureState.expired.authenticated ||
        !authFailureState.expired.credentialCleared ||
        !authFailureState.expired.authText.includes("Googleでログイン") ||
        authFailureState.unavailable.mode !== "unavailable" ||
        authFailureState.unavailable.authenticated ||
        !authFailureState.unavailable.authText.includes("認証状態を確認できません")) {
      fail(`Authentication recovery/fail-closed UI check failed: ${JSON.stringify(authFailureState)}`);
    }

    await evaluate(client, `(() => {
      const industry = document.querySelector("#industry");
      const propose = document.querySelector("#propose");
      industry.value = "x".repeat(121);
      propose.focus();
      propose.click();
      return true;
    })()`);
    await waitForBrowserCondition(
      client,
      `document.activeElement === document.querySelector("#status") && document.querySelector("#status").textContent.includes("120文字以内")`,
      "overlong industry error focus"
    );
    const coreInputConstraintState = await evaluate(client, `(() => {
      const industry = document.querySelector("#industry");
      const result = {
        industryMaxLength: industry.maxLength,
        projectLabelMaxLength: document.querySelector("#projectLabel").maxLength,
        salesOwnerMaxLength: document.querySelector("#salesOwner").maxLength,
        statusTabIndex: document.querySelector("#status").tabIndex,
        statusFocused: document.activeElement === document.querySelector("#status"),
        industryInvalid: industry.getAttribute("aria-invalid"),
        proposeEnabled: !document.querySelector("#propose").disabled
      };
      industry.value = "板金加工業者";
      return result;
    })()`);
    if (coreInputConstraintState?.industryMaxLength !== 120 ||
        coreInputConstraintState.projectLabelMaxLength !== 80 ||
        coreInputConstraintState.salesOwnerMaxLength !== 80 ||
        coreInputConstraintState.statusTabIndex !== -1 ||
        !coreInputConstraintState.statusFocused ||
        coreInputConstraintState.industryInvalid !== "true" ||
        !coreInputConstraintState.proposeEnabled) {
      fail(`Core input constraint check failed: ${JSON.stringify(coreInputConstraintState)}`);
    }

    await evaluate(client, `(() => {
      document.querySelector("#industry").value = "板金加工業者";
      document.querySelector("#dashboardType").value = "manufacturing";
      document.querySelector("#propose").click();
      return true;
    })()`);
    await waitForBrowserCondition(
      client,
      `document.querySelectorAll("#previewBoard .preview-panel").length >= 7 && !document.querySelector("#propose").disabled`,
      "manufacturing proposal preview"
    );

    const desktopState = await evaluate(client, `(() => {
      const app = document.querySelector(".app");
      const aside = document.querySelector("aside");
      const main = document.querySelector("main");
      const activeStep = document.querySelector("#workflowSteps .is-active")?.dataset.step || "";
      return {
        previewPanelCount: document.querySelectorAll("#previewBoard .preview-panel").length,
        panelCardCount: document.querySelectorAll("#panels .panel-card").length,
        gridItemCount: document.querySelectorAll("#previewBoard .grid-stack-item").length,
        previewMenuCount: document.querySelectorAll("#previewBoard .preview-menu-button").length,
        validGridPosCount: state.panels.filter((panel) => normalizeClientGridPos(panel.gridPos)).length,
        layoutErrorCount: validateClientPanelLayouts(state.panels).length,
        previewModeSelected: document.querySelector("#previewModeTab")?.getAttribute("aria-selected"),
        listEditorHidden: document.querySelector("#listEditor")?.hidden,
        riskDirectionSelectCount: document.querySelectorAll('#panels select[data-key="riskDirection"]').length,
        lowRiskPanelCount: state.panels.filter((panel) => panel.riskDirection === "low").length,
        panelFieldCount: document.querySelectorAll("#panels [data-key]").length,
        associatedPanelFieldCount: Array.from(document.querySelectorAll("#panels [data-key]"))
          .filter((field) => field.id && document.querySelector('label[for="' + field.id + '"]')).length,
        firstPanelTitle: state.panels[0]?.title || "",
        firstPanelSource: state.panels[0]?.proposalSource || "",
        rationaleCount: state.panels.filter((panel) => panel.rationale).length,
        demoRangeCount: state.panels.filter((panel) => panel.rangeSource === "testdata-demo-default").length,
        processOptionCount: document.querySelectorAll("#primaryProcess option").length,
        equipmentOptionCount: document.querySelectorAll('#equipmentOptions input[type="checkbox"]').length,
        proposalSummaryVisible: !document.querySelector("#proposalSourceSummary").hidden,
        proposalSummaryText: document.querySelector("#proposalSourceSummary").textContent,
        availabilityRisk: (() => {
          const panel = state.panels.find((item) => item.title === "Availability / Uptime");
          return panel ? {
            direction: panel.riskDirection,
            warning: panel.warningThreshold,
            critical: panel.criticalThreshold
          } : null;
        })(),
        activeStep,
        appColumns: getComputedStyle(app).gridTemplateColumns,
        asideWidth: Math.round(aside.getBoundingClientRect().width),
        mainWidth: Math.round(main.getBoundingClientRect().width),
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })()`) || {};
    if (desktopState.previewPanelCount < 7 || desktopState.panelCardCount < 7) {
      fail(`Proposal did not render enough panels: ${JSON.stringify(desktopState)}`);
    }
    if (desktopState.gridItemCount !== desktopState.previewPanelCount ||
        desktopState.previewMenuCount !== desktopState.previewPanelCount ||
        desktopState.validGridPosCount !== desktopState.previewPanelCount ||
        desktopState.layoutErrorCount !== 0 ||
        desktopState.previewModeSelected !== "true" ||
        !desktopState.listEditorHidden) {
      fail(`Preview editor initialization failed: ${JSON.stringify(desktopState)}`);
    }
    if (desktopState.riskDirectionSelectCount !== desktopState.panelCardCount ||
        desktopState.lowRiskPanelCount < 1 ||
        desktopState.availabilityRisk?.direction !== "low" ||
        !(desktopState.availabilityRisk.warning > desktopState.availabilityRisk.critical)) {
      fail(`Risk-direction UI check failed: ${JSON.stringify(desktopState)}`);
    }
    if (!desktopState.panelFieldCount || desktopState.associatedPanelFieldCount !== desktopState.panelFieldCount) {
      fail(`Panel form labels are not fully associated: ${JSON.stringify(desktopState)}`);
    }
    if (desktopState.firstPanelTitle !== "Bending Force" ||
        desktopState.firstPanelSource !== "process-catalog" ||
        desktopState.rationaleCount !== desktopState.previewPanelCount ||
        desktopState.demoRangeCount !== desktopState.previewPanelCount ||
        desktopState.processOptionCount < 2 ||
        desktopState.equipmentOptionCount < 1 ||
        !desktopState.proposalSummaryVisible ||
        !desktopState.proposalSummaryText.includes("工程カタログ") ||
        !desktopState.proposalSummaryText.includes("TestData")) {
      fail(`Process proposal explanation check failed: ${JSON.stringify(desktopState)}`);
    }
    const extendedVisualizationState = await evaluate(client, `(() => {
      const original = state.panels.slice(0, 3).map((panel) => ({
        visualization: panel.visualization,
        latestOnly: panel.latestOnly
      }));
      ["barchart", "bargauge", "heatmap"].forEach((visualization, index) => {
        state.panels[index].visualization = visualization;
        state.panels[index].latestOnly = visualization === "bargauge";
      });
      renderPanels();
      const bodies = Array.from(document.querySelectorAll("#previewBoard .preview-body")).slice(0, 3).map((element) => element.innerHTML);
      const result = {
        barChartRendered: bodies[0].includes("Period 1") && bodies[0].includes("<rect"),
        barGaugeRendered: bodies[1].includes("Asset 1") && bodies[1].includes("<rect"),
        heatmapRendered: bodies[2].includes("High") && bodies[2].includes("-6h"),
        listOptions: Array.from(document.querySelectorAll('#panels select[data-key="visualization"] option')).map((option) => option.value),
        dialogOptions: Array.from(document.querySelectorAll('#dialogPanelVisualization option')).map((option) => option.value),
        errors: validatePanels().length
      };
      original.forEach((value, index) => Object.assign(state.panels[index], value));
      renderPanels();
      return result;
    })()`);
    const requiredExtendedTypes = ["barchart", "bargauge", "heatmap"];
    if (!extendedVisualizationState?.barChartRendered ||
        !extendedVisualizationState.barGaugeRendered ||
        !extendedVisualizationState.heatmapRendered ||
        !requiredExtendedTypes.every((type) => extendedVisualizationState.listOptions.includes(type)) ||
        !requiredExtendedTypes.every((type) => extendedVisualizationState.dialogOptions.includes(type)) ||
        extendedVisualizationState.errors !== 0) {
      fail(`Extended visualization preview check failed: ${JSON.stringify(extendedVisualizationState)}`);
    }
    if (desktopState.activeStep !== "2") fail(`Workflow must advance to step 2 after proposal: ${JSON.stringify(desktopState)}`);
    if (desktopState.asideWidth < 300 || desktopState.mainWidth < 700 || desktopState.documentOverflow) {
      fail(`Desktop layout check failed: ${JSON.stringify(desktopState)}`);
    }

    const editorModeState = await evaluate(client, `(() => {
      document.querySelector("#listModeTab").click();
      const list = {
        listSelected: document.querySelector("#listModeTab").getAttribute("aria-selected"),
        previewHidden: document.querySelector("#previewSection").hidden,
        listHidden: document.querySelector("#listEditor").hidden,
        previewDisplay: getComputedStyle(document.querySelector("#previewSection")).display
      };
      document.querySelector("#previewModeTab").click();
      const preview = {
        previewSelected: document.querySelector("#previewModeTab").getAttribute("aria-selected"),
        previewHidden: document.querySelector("#previewSection").hidden,
        listHidden: document.querySelector("#listEditor").hidden,
        listDisplay: getComputedStyle(document.querySelector("#listEditor")).display,
        gridReady: Boolean(previewGrid)
      };
      return { list, preview };
    })()`);
    if (editorModeState?.list.listSelected !== "true" ||
        !editorModeState.list.previewHidden ||
        editorModeState.list.listHidden ||
        editorModeState.list.previewDisplay !== "none" ||
        editorModeState.preview.previewSelected !== "true" ||
        editorModeState.preview.previewHidden ||
        !editorModeState.preview.listHidden ||
        editorModeState.preview.listDisplay !== "none" ||
        !editorModeState.preview.gridReady) {
      fail(`Editor mode switch failed: ${JSON.stringify(editorModeState)}`);
    }

    const originalDialogPanel = await evaluate(client, `({ title: state.panels[0].title, purpose: state.panels[0].purpose })`);
    await evaluate(client, `document.querySelector('#previewBoard .preview-panel[data-panel-index="0"] .preview-menu-button').click()`);
    const previewMenuState = await evaluate(client, `(() => {
      const panel = document.querySelector('#previewBoard .preview-panel[data-panel-index="0"]');
      return {
        expanded: panel.querySelector(".preview-menu-button").getAttribute("aria-expanded"),
        menuHidden: panel.querySelector(".preview-context-menu").hidden,
        actionCount: panel.querySelectorAll(".preview-context-menu button").length
      };
    })()`);
    await evaluate(client, `document.querySelector('#previewBoard .preview-panel[data-panel-index="0"] [data-action="edit"]').click()`);
    await waitForBrowserCondition(client, `document.querySelector("#panelEditorDialog").open`, "panel edit dialog open");
    const dialogOpenState = await evaluate(client, `(() => ({
      open: document.querySelector("#panelEditorDialog").open,
      title: document.querySelector("#dialogPanelTitle").value,
      focused: document.activeElement === document.querySelector("#dialogPanelTitle"),
      fieldCount: document.querySelectorAll("#panelDialogForm [data-dialog-key]").length
    }))()`);
    await evaluate(client, `(() => {
      document.querySelector("#dialogPanelTitle").value = ${JSON.stringify(originalDialogPanel.title + " - Dialog")};
      document.querySelector("#dialogPanelPurpose").value = "Dialog edit verification";
      document.querySelector("#panelDialogForm").requestSubmit();
      return true;
    })()`);
    await waitForBrowserCondition(client, `!document.querySelector("#panelEditorDialog").open`, "panel edit dialog apply");
    const dialogAppliedState = await evaluate(client, `(() => ({
      stateTitle: state.panels[0].title,
      statePurpose: state.panels[0].purpose,
      previewTitle: document.querySelector('#previewBoard .preview-panel[data-panel-index="0"] .preview-title')?.textContent || "",
      listTitle: document.querySelector('#panels .panel-card[data-panel-index="0"] input[data-key="title"]')?.value || ""
    }))()`);
    await evaluate(client, `(() => {
      openPanelEditor(0);
      document.querySelector("#dialogPanelTitle").value = ${JSON.stringify(originalDialogPanel.title)};
      document.querySelector("#dialogPanelPurpose").value = ${JSON.stringify(originalDialogPanel.purpose)};
      document.querySelector("#panelDialogForm").requestSubmit();
      return true;
    })()`);
    const dialogRestoredState = await evaluate(client, `(() => ({
      title: state.panels[0].title,
      purpose: state.panels[0].purpose,
      dialogClosed: !document.querySelector("#panelEditorDialog").open
    }))()`);
    if (previewMenuState?.expanded !== "true" || previewMenuState.menuHidden || previewMenuState.actionCount !== 4 ||
        !dialogOpenState?.open || dialogOpenState.title !== originalDialogPanel.title || !dialogOpenState.focused || dialogOpenState.fieldCount !== 10 ||
        dialogAppliedState?.stateTitle !== `${originalDialogPanel.title} - Dialog` ||
        dialogAppliedState.statePurpose !== "Dialog edit verification" ||
        dialogAppliedState.previewTitle !== dialogAppliedState.stateTitle ||
        dialogAppliedState.listTitle !== dialogAppliedState.stateTitle ||
        dialogRestoredState.title !== originalDialogPanel.title || dialogRestoredState.purpose !== originalDialogPanel.purpose || !dialogRestoredState.dialogClosed) {
      fail(`Panel preview menu/dialog check failed: ${JSON.stringify({ previewMenuState, dialogOpenState, dialogAppliedState, dialogRestoredState })}`);
    }

    await evaluate(client, `(() => {
      document.querySelector('#previewBoard .preview-panel[data-panel-index="0"] .preview-drag-handle').scrollIntoView({ block: "center" });
      return true;
    })()`);
    await wait(400);
    const dragTarget = await evaluate(client, `(() => {
      const handle = document.querySelector('#previewBoard .preview-panel[data-panel-index="0"] .preview-drag-handle');
      const rect = handle.getBoundingClientRect();
      return {
        x: Math.round(rect.left + Math.min(90, rect.width / 3)),
        y: Math.round(rect.top + rect.height / 2),
        before: state.panels.map((panel) => ({ ...panel.gridPos }))
      };
    })()`);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: dragTarget.x, y: dragTarget.y, button: "left", buttons: 1, clickCount: 1 });
    await wait(80);
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragTarget.x + 8, y: dragTarget.y + 8, button: "left", buttons: 1 });
    await wait(80);
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragTarget.x + 70, y: dragTarget.y + 45, button: "left", buttons: 1 });
    await wait(80);
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: dragTarget.x + 210, y: dragTarget.y + 155, button: "left", buttons: 1 });
    await wait(120);
    await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: dragTarget.x + 210, y: dragTarget.y + 155, button: "left", buttons: 0, clickCount: 1 });
    await wait(650);
    const dragState = await evaluate(client, `(() => ({
      after: state.panels.map((panel) => ({ ...panel.gridPos })),
      historyCount: state.layoutHistory.length,
      undoEnabled: !document.querySelector("#undoLayout").disabled,
      layoutErrors: validateClientPanelLayouts(state.panels).length
    }))()`);
    if (JSON.stringify(dragState?.after) === JSON.stringify(dragTarget.before) || dragState.historyCount < 1 || !dragState.undoEnabled || dragState.layoutErrors !== 0) {
      fail(`Mouse drag layout check failed: ${JSON.stringify({ dragTarget, dragState })}`);
    }
    await evaluate(client, `document.querySelector("#undoLayout").click()`);
    const undoLayoutState = await evaluate(client, `(() => ({
      restored: sameLayout(layoutSnapshot(), ${JSON.stringify(dragTarget.before)}),
      errors: validateClientPanelLayouts(state.panels).length
    }))()`);
    if (!undoLayoutState?.restored || undoLayoutState.errors !== 0) {
      fail(`Layout undo check failed: ${JSON.stringify(undoLayoutState)}`);
    }

    const resetLayoutState = await evaluate(client, `(() => {
      state.panels[0].gridPos = { ...state.panels[0].gridPos, x: 0, y: 100 };
      renderPanels();
      document.querySelector("#resetLayout").click();
      const expected = previewPositions(state.panels);
      const actual = state.panels.map((panel) => panel.gridPos);
      const result = {
        reset: actual.length === expected.length && actual.every((position, index) =>
          position.x === expected[index].x && position.y === expected[index].y &&
          position.w === expected[index].w && position.h === expected[index].h),
        errors: validateClientPanelLayouts(state.panels).length,
        historyCount: state.layoutHistory.length,
        firstActual: actual.slice(0, 6),
        firstExpected: expected.slice(0, 6)
      };
      state.layoutHistory = [];
      updateCreateState();
      return result;
    })()`);
    if (!resetLayoutState?.reset || resetLayoutState.errors !== 0 || resetLayoutState.historyCount < 1) {
      fail(`Layout reset check failed: ${JSON.stringify(resetLayoutState)}`);
    }

    const tabletModeState = await evaluate(client, `(() => {
      document.querySelector('[data-device-mode="tablet"]').click();
      const toggle = document.querySelector("#tabletConditionsToggle");
      toggle.click();
      const open = {
        tabletClass: document.body.classList.contains("device-tablet"),
        drawerOpen: document.body.classList.contains("tablet-conditions-open"),
        toggleDisplay: getComputedStyle(toggle).display,
        touchTarget: Math.round(toggle.getBoundingClientRect().height),
        asidePosition: getComputedStyle(document.querySelector("aside")).position
      };
      document.querySelector("#tabletConditionsClose").click();
      const closed = !document.body.classList.contains("tablet-conditions-open");
      document.querySelector('[data-device-mode="auto"]').click();
      return { open, closed, selectedAuto: document.querySelector('[data-device-mode="auto"]').getAttribute("aria-pressed") };
    })()`);
    if (!tabletModeState?.open.tabletClass || !tabletModeState.open.drawerOpen || tabletModeState.open.toggleDisplay === "none" ||
        tabletModeState.open.touchTarget < 44 || tabletModeState.open.asidePosition !== "fixed" || !tabletModeState.closed || tabletModeState.selectedAuto !== "true") {
      fail(`Tablet mode check failed: ${JSON.stringify(tabletModeState)}`);
    }

    const panelLimitState = await evaluate(client, `(() => {
      const originalPanels = state.panels;
      state.panels = Array.from({ length: MAX_PANEL_COUNT }, (_, index) => ({
        ...originalPanels[index % originalPanels.length],
        id: index + 1,
        title: "Limit Panel " + (index + 1)
      }));
      renderPanels();
      const addButton = document.querySelector("#addPanel");
      const result = {
        count: state.panels.length,
        addDisabled: addButton.disabled,
        addTitle: addButton.title,
        summary: document.querySelector("#panelFilterSummary")?.textContent || ""
      };
      addButton.click();
      result.countAfterClick = state.panels.length;
      state.panels = originalPanels;
      renderPanels();
      result.restoredCount = state.panels.length;
      result.addEnabledAfterRestore = !document.querySelector("#addPanel").disabled;
      return result;
    })()`);
    if (panelLimitState?.count !== 24 ||
        !panelLimitState.addDisabled ||
        !panelLimitState.addTitle.includes("最大24") ||
        !panelLimitState.summary.includes("最大24") ||
        panelLimitState.countAfterClick !== 24 ||
        panelLimitState.restoredCount !== desktopState.panelCardCount ||
        !panelLimitState.addEnabledAfterRestore) {
      fail(`Panel limit check failed: ${JSON.stringify(panelLimitState)}`);
    }

    const originalPanelCountBeforeAdd = desktopState.panelCardCount;
    await evaluate(client, `document.querySelector("#addPanel").click()`);
    await waitForBrowserCondition(
      client,
      `document.activeElement?.matches('.panel-card[data-panel-index="${originalPanelCountBeforeAdd}"] input[data-key="title"]')`,
      "new panel title focus"
    );
    const addPanelFocusState = await evaluate(client, `(() => {
      const active = document.activeElement;
      const result = {
        count: state.panels.length,
        previewCount: document.querySelectorAll("#previewBoard .preview-panel").length,
        activeTitle: active?.value || "",
        activePanelIndex: active?.closest(".panel-card")?.dataset.panelIndex || "",
        selectionCoversTitle: active?.selectionStart === 0 && active?.selectionEnd === active?.value.length
      };
      state.panels.pop();
      renderPanels();
      result.restoredCount = state.panels.length;
      return result;
    })()`);
    if (addPanelFocusState?.count !== originalPanelCountBeforeAdd + 1 ||
        addPanelFocusState.previewCount !== originalPanelCountBeforeAdd + 1 ||
        addPanelFocusState.activeTitle !== "New Sensor Panel" ||
        addPanelFocusState.activePanelIndex !== String(originalPanelCountBeforeAdd) ||
        !addPanelFocusState.selectionCoversTitle ||
        addPanelFocusState.restoredCount !== originalPanelCountBeforeAdd) {
      fail(`Add panel focus check failed: ${JSON.stringify(addPanelFocusState)}`);
    }

    const duplicateSourceState = await evaluate(client, `(() => ({
      title: state.panels[0].title,
      visualization: state.panels[0].visualization,
      unit: state.panels[0].unit,
      min: state.panels[0].min,
      max: state.panels[0].max
    }))()`);
    await evaluate(client, `document.querySelector("#panels .panel-card .duplicate-panel").click()`);
    await waitForBrowserCondition(
      client,
      `document.activeElement?.matches('.panel-card[data-panel-index="1"] input[data-key="title"]')`,
      "duplicated panel title focus"
    );
    const duplicatePanelState = await evaluate(client, `(() => {
      const copy = state.panels[1];
      const result = {
        count: state.panels.length,
        title: copy.title,
        visualization: copy.visualization,
        unit: copy.unit,
        min: copy.min,
        max: copy.max,
        uniqueId: copy.id !== state.panels[0].id,
        activePanelIndex: document.activeElement?.closest(".panel-card")?.dataset.panelIndex || "",
        previewTitle: document.querySelector('#previewBoard .preview-panel[data-panel-index="1"] .preview-title')?.textContent || ""
      };
      state.panels.splice(1, 1);
      renderPanels();
      result.restoredCount = state.panels.length;
      return result;
    })()`);
    if (duplicatePanelState?.count !== originalPanelCountBeforeAdd + 1 ||
        duplicatePanelState.title !== `${duplicateSourceState.title} - Copy` ||
        duplicatePanelState.visualization !== duplicateSourceState.visualization ||
        duplicatePanelState.unit !== duplicateSourceState.unit ||
        duplicatePanelState.min !== duplicateSourceState.min ||
        duplicatePanelState.max !== duplicateSourceState.max ||
        !duplicatePanelState.uniqueId ||
        duplicatePanelState.activePanelIndex !== "1" ||
        duplicatePanelState.previewTitle !== duplicatePanelState.title ||
        duplicatePanelState.restoredCount !== originalPanelCountBeforeAdd) {
      fail(`Duplicate panel check failed: ${JSON.stringify(duplicatePanelState)}`);
    }

    const deleteUndoBefore = await evaluate(client, `state.panels.map((panel) => panel.title)`);
    await evaluate(client, `document.querySelector("#panels .panel-card .delete-panel").click()`);
    const deleteState = await evaluate(client, `(() => ({
      count: state.panels.length,
      bannerVisible: !document.querySelector("#panelUndo").hidden,
      bannerText: document.querySelector("#panelUndoText").textContent,
      deletedTitle: state.deletedPanel?.panel?.title || ""
    }))()`);
    await evaluate(client, `document.querySelector("#undoDelete").click()`);
    await waitForBrowserCondition(
      client,
      `state.panels.length === ${originalPanelCountBeforeAdd} && document.querySelector("#panelUndo").hidden`,
      "panel delete undo"
    );
    const deleteUndoState = await evaluate(client, `(() => ({
      ...${JSON.stringify(deleteState)},
      restoredTitles: state.panels.map((panel) => panel.title),
      restoredPreviewTitles: Array.from(document.querySelectorAll("#previewBoard .preview-title")).map((element) => element.textContent),
      deletedStateCleared: state.deletedPanel === null,
      bannerHidden: document.querySelector("#panelUndo").hidden
    }))()`);
    if (deleteUndoState?.count !== originalPanelCountBeforeAdd - 1 ||
        !deleteUndoState.bannerVisible ||
        !deleteUndoState.bannerText.includes(deleteUndoState.deletedTitle) ||
        JSON.stringify(deleteUndoState.restoredTitles) !== JSON.stringify(deleteUndoBefore) ||
        JSON.stringify(deleteUndoState.restoredPreviewTitles) !== JSON.stringify(deleteUndoBefore) ||
        !deleteUndoState.deletedStateCleared ||
        !deleteUndoState.bannerHidden) {
      fail(`Panel delete undo check failed: ${JSON.stringify(deleteUndoState)}`);
    }

    const invalidPanelState = await evaluate(client, `(() => {
      const targetIndex = 3;
      const originalMax = state.panels[targetIndex].max;
      state.panels[targetIndex].max = state.panels[targetIndex].min;
      renderPanels();
      const expectedInvalidIndexes = state.panels
        .map((panel, index) => panelValidationErrors(panel, index).length ? String(index) : null)
        .filter((index) => index !== null);
      const toggle = document.querySelector("#invalidOnly");
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      const visibleIndexes = Array.from(document.querySelectorAll("#panels .panel-card"))
        .map((card) => card.dataset.panelIndex);
      const result = {
        expectedInvalidIndexes,
        visibleIndexes,
        summary: document.querySelector("#panelFilterSummary")?.textContent || "",
        createDisabledWhileInvalid: document.querySelector("#create").disabled,
        validationMessageCount: document.querySelectorAll("#panels .validation-list li").length
      };
      state.panels[targetIndex].max = originalMax;
      toggle.checked = false;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      result.restoredCount = document.querySelectorAll("#panels .panel-card").length;
      result.createEnabledAfterRestore = !document.querySelector("#create").disabled;
      result.errorCountAfterRestore = state.panels.filter((panel, index) => panelValidationErrors(panel, index).length > 0).length;
      return result;
    })()`);
    if (!invalidPanelState?.expectedInvalidIndexes.length ||
        JSON.stringify(invalidPanelState.visibleIndexes) !== JSON.stringify(invalidPanelState.expectedInvalidIndexes) ||
        !invalidPanelState.summary.includes(`エラー ${invalidPanelState.expectedInvalidIndexes.length}`) ||
        !invalidPanelState.createDisabledWhileInvalid ||
        invalidPanelState.validationMessageCount < 1 ||
        invalidPanelState.restoredCount !== originalPanelCountBeforeAdd ||
        !invalidPanelState.createEnabledAfterRestore ||
        invalidPanelState.errorCountAfterRestore !== 0) {
      fail(`Invalid panel filter check failed: ${JSON.stringify(invalidPanelState)}`);
    }

    const panelInputConstraintState = await evaluate(client, `(() => ({
      titleMaxLength: document.querySelector('#panels input[data-key="title"]')?.maxLength,
      unitMaxLength: document.querySelector('#panels input[data-key="unit"]')?.maxLength,
      purposeMaxLength: document.querySelector('#panels textarea[data-key="purpose"]')?.maxLength,
      industryInvalidCleared: !document.querySelector("#industry").hasAttribute("aria-invalid")
    }))()`);
    if (panelInputConstraintState?.titleMaxLength !== 80 ||
        panelInputConstraintState.unitMaxLength !== 32 ||
        panelInputConstraintState.purposeMaxLength !== 160 ||
        !panelInputConstraintState.industryInvalidCleared) {
      fail(`Panel input constraint check failed: ${JSON.stringify(panelInputConstraintState)}`);
    }

    const panelFilterState = await evaluate(client, `(() => {
      const input = document.querySelector("#panelFilter");
      input.value = "Bending";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const filteredTitles = Array.from(document.querySelectorAll('#panels .panel-card input[data-key="title"]')).map((element) => element.value);
      const filteredSummary = document.querySelector("#panelFilterSummary")?.textContent || "";
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return {
        filteredTitles,
        filteredSummary,
        restoredCount: document.querySelectorAll("#panels .panel-card").length
      };
    })()`);
    if (!panelFilterState?.filteredTitles.length ||
        panelFilterState.filteredTitles.length >= desktopState.panelCardCount ||
        !panelFilterState.filteredTitles.every((title) => title.toLowerCase().includes("bending")) ||
        panelFilterState.restoredCount !== desktopState.panelCardCount) {
      fail(`Panel filter check failed: ${JSON.stringify(panelFilterState)}`);
    }

    const panelOrderState = await evaluate(client, `(() => {
      const before = state.panels.slice(0, 2).map((panel) => panel.title);
      const firstUpDisabled = document.querySelector("#panels .panel-card .move-up")?.disabled === true;
      document.querySelector("#panels .panel-card .move-down").click();
      const moved = state.panels.slice(0, 2).map((panel) => panel.title);
      const movedPreview = Array.from(document.querySelectorAll("#previewBoard .preview-title")).slice(0, 2).map((element) => element.textContent);
      document.querySelectorAll("#panels .panel-card")[1].querySelector(".move-up").click();
      const restored = state.panels.slice(0, 2).map((panel) => panel.title);
      return { before, moved, movedPreview, restored, firstUpDisabled };
    })()`);
    if (!panelOrderState?.firstUpDisabled ||
        panelOrderState.moved[0] !== panelOrderState.before[1] ||
        panelOrderState.moved[1] !== panelOrderState.before[0] ||
        panelOrderState.movedPreview[0] !== panelOrderState.moved[0] ||
        JSON.stringify(panelOrderState.restored) !== JSON.stringify(panelOrderState.before)) {
      fail(`Panel reorder check failed: ${JSON.stringify(panelOrderState)}`);
    }

    const grafanaUrlState = await evaluate(client, `(() => {
      const originalUrl = state.grafanaUrl;
      state.grafanaUrl = "https://tenant-check.grafana.net";
      renderMeta();
      const configuredHref = document.querySelector("#dashboardMeta a")?.href || "";
      state.grafanaUrl = originalUrl;
      renderMeta();
      return {
        configuredHref,
        restoredHref: document.querySelector("#dashboardMeta a")?.href || ""
      };
    })()`);
    if (!grafanaUrlState?.configuredHref.startsWith("https://tenant-check.grafana.net/d/") ||
        grafanaUrlState.restoredHref.includes("tenant-check.grafana.net")) {
      fail(`Runtime Grafana URL check failed: ${JSON.stringify(grafanaUrlState)}`);
    }

    await evaluate(client, `(() => {
      const titleInput = document.querySelector('#panels .panel-card input[data-key="title"]');
      const projectLabel = document.querySelector("#projectLabel");
      document.querySelector("#appAccessToken").value = "DO-NOT-PERSIST";
      titleInput.value = "Overall Equipment Effectiveness - Draft";
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
      projectLabel.value = "Draft Restore Test";
      projectLabel.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    await waitForBrowserCondition(
      client,
      `(() => {
        const raw = localStorage.getItem("grafanaBuilderDraftV1") || "";
        return raw.includes("Overall Equipment Effectiveness - Draft") &&
          raw.includes("Draft Restore Test") &&
          !raw.includes("DO-NOT-PERSIST") &&
          document.querySelector("#draftState")?.textContent.includes("自動保存");
      })()`,
      "draft autosave"
    );

    await evaluate(client, `(() => {
      const projectLabel = document.querySelector("#projectLabel");
      projectLabel.value = "Immediate Reload Draft";
      projectLabel.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

    const reloadLoaded = new Promise((resolve) => {
      const timeout = setTimeout(resolve, browserTimeoutMs);
      client.on("Page.loadEventFired", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await client.send("Page.reload", { ignoreCache: true });
    await reloadLoaded;
    await waitForBrowserCondition(
      client,
      `document.querySelector('#panels .panel-card input[data-key="title"]')?.value === "Overall Equipment Effectiveness - Draft" && document.querySelector("#projectLabel")?.value === "Immediate Reload Draft"`,
      "draft restore after reload"
    );
    const draftRestoreState = await evaluate(client, `(() => ({
      firstPanelTitle: document.querySelector('#panels .panel-card input[data-key="title"]')?.value || "",
      projectLabel: document.querySelector("#projectLabel")?.value || "",
      panelCount: document.querySelectorAll("#panels .panel-card").length,
      activeStep: document.querySelector("#workflowSteps .is-active")?.dataset.step || "",
      draftState: document.querySelector("#draftState")?.textContent || "",
      accessTokenRestored: Boolean(document.querySelector("#appAccessToken")?.value)
    }))()`) || {};
    if (draftRestoreState.panelCount < 7 || draftRestoreState.activeStep !== "2" || draftRestoreState.accessTokenRestored) {
      fail(`Draft restore check failed: ${JSON.stringify(draftRestoreState)}`);
    }

    const apiFailureState = await evaluate(client, `(async () => {
      const originalFetch = window.fetch;
      const timeoutStartedAt = performance.now();
      let timeoutMessage = "";
      let connectionMessage = "";
      try {
        window.fetch = (_path, options) => new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
        try {
          await apiGet("/api/ping", 25);
        } catch (error) {
          timeoutMessage = error.message;
        }
        window.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
        try {
          await apiGet("/api/ping", 25);
        } catch (error) {
          connectionMessage = error.message;
        }
      } finally {
        window.fetch = originalFetch;
      }
      return {
        timeoutMessage,
        connectionMessage,
        elapsedMs: Math.round(performance.now() - timeoutStartedAt)
      };
    })()`);
    if (!apiFailureState?.timeoutMessage.includes("通信が") ||
        !apiFailureState.timeoutMessage.includes("もう一度実行") ||
        !apiFailureState.connectionMessage.includes("サーバーに接続できません") ||
        apiFailureState.elapsedMs > 1000) {
      fail(`Browser API timeout guidance check failed: ${JSON.stringify(apiFailureState)}`);
    }
    await client.send("Page.bringToFront");
    await wait(750);
    const dashboardHistoryState = await evaluate(client, `(() => {
      state.dashboardHistorySource = "firestore";
      state.dashboardHistoryRows = [{
        time: "2026-07-10T14:53:20.000Z",
        dashboardUid: "sheet-metal-maintenance-demo",
        dashboardTitle: "sheet-metal machine maintenance demo",
        dashboardType: "manufacturing",
        dashboardUrl: "https://ytsutsumi30.grafana.net/d/sheet-metal-maintenance-demo/sheet-metal-machine-maintenance-demo",
        industry: "板金加工業者",
        message: "Dashboard created. overwrite=true"
      }];
      renderDashboardHistory();
      const item = document.querySelector("#dashboardHistory .history-item");
      const link = item?.querySelector(".history-open-link");
      return {
        itemCount: document.querySelectorAll("#dashboardHistory .history-item").length,
        title: item?.querySelector(".history-title")?.textContent || "",
        result: item?.querySelector(".history-result")?.textContent || "",
        linkText: link?.textContent || "",
        linkHref: link?.href || "",
        rawUrlVisible: item?.innerText.includes("https://") || false
      };
    })()`);
    if (dashboardHistoryState?.itemCount !== 1 ||
        dashboardHistoryState.title !== "sheet-metal machine maintenance demo" ||
        dashboardHistoryState.result !== "上書き" ||
        dashboardHistoryState.linkText !== "Grafanaで開く" ||
        !dashboardHistoryState.linkHref.startsWith("https://ytsutsumi30.grafana.net/d/") ||
        dashboardHistoryState.rawUrlVisible) {
      fail(`Dashboard history visualization check failed: ${JSON.stringify(dashboardHistoryState)}`);
    }
    await evaluate(client, `(() => {
      setEditorMode("preview");
      setDeviceMode("desktop");
      document.querySelector("#workflowSection").scrollIntoView({ block: "start" });
      return true;
    })()`);
    await wait(500);
    const desktopScreenshot = await captureScreenshot(client, "latest-desktop.png");
    await evaluate(client, `openPanelEditor(0)`);
    await waitForBrowserCondition(client, `document.querySelector("#panelEditorDialog").open`, "panel dialog screenshot");
    const dialogScreenshot = await captureScreenshot(client, "latest-panel-dialog.png");
    await evaluate(client, `closePanelEditor()`);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false
    });
    await evaluate(client, `(() => {
      setDeviceMode("tablet");
      closeTabletConditions();
      document.querySelector("#workflowSection").scrollIntoView({ block: "start" });
      return true;
    })()`);
    await wait(500);
    const tabletScreenshot = await captureScreenshot(client, "latest-tablet.png");
    await evaluate(client, `setDeviceMode("auto")`);

    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true
    });
    await wait(500);
    const mobileState = await evaluate(client, `(() => {
      const app = document.querySelector(".app");
      const aside = document.querySelector("aside");
      const main = document.querySelector("main");
      const preview = document.querySelector(".preview");
      const historyItem = document.querySelector("#dashboardHistory .history-item");
      const historyLink = historyItem?.querySelector(".history-open-link");
      return {
        appColumns: getComputedStyle(app).gridTemplateColumns,
        asideWidth: Math.round(aside.getBoundingClientRect().width),
        mainWidth: Math.round(main.getBoundingClientRect().width),
        viewportWidth: document.documentElement.clientWidth,
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        previewScrollable: preview.scrollWidth > preview.clientWidth,
        historyFits: Boolean(historyItem) && historyItem.scrollWidth <= historyItem.clientWidth,
        historyLinkFits: Boolean(historyLink) && historyLink.scrollWidth <= historyLink.clientWidth
      };
    })()`) || {};
    if (mobileState.asideWidth > mobileState.viewportWidth || mobileState.mainWidth > mobileState.viewportWidth) {
      fail(`Mobile content exceeds viewport: ${JSON.stringify(mobileState)}`);
    }
    if (mobileState.documentOverflow || !mobileState.previewScrollable || !mobileState.historyFits || !mobileState.historyLinkFits) {
      fail(`Mobile overflow containment check failed: ${JSON.stringify(mobileState)}`);
    }
    await evaluate(client, `(() => {
      document.querySelector("#dashboardHistory")?.scrollIntoView({ block: "center" });
      return true;
    })()`);
    await wait(350);
    const historyMobileScreenshot = await captureScreenshot(client, "latest-history-mobile.png");
    const mobileNavigationState = await evaluate(client, `(async () => {
      const nav = document.querySelector(".mobile-nav");
      const previewButton = nav.querySelector('[data-target="previewSection"]');
      previewButton.click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      const previewFocused = document.activeElement?.id === "previewSection";
      nav.querySelector('[data-target="conditionsSection"]').click();
      await new Promise((resolve) => setTimeout(resolve, 350));
      const conditionsFocused = document.activeElement?.id === "conditionsSection";
      let createForwarded = false;
      const create = document.querySelector("#create");
      create.addEventListener("click", (event) => {
        createForwarded = true;
        event.stopImmediatePropagation();
        event.preventDefault();
      }, { capture: true, once: true });
      nav.querySelector('[data-action="create"]').click();
      return {
        display: getComputedStyle(nav).display,
        buttonCount: nav.querySelectorAll("button").length,
        previewFocused,
        conditionsFocused,
        createEnabled: !nav.querySelector('[data-action="create"]').disabled,
        createForwarded
      };
    })()`);
    if (mobileNavigationState?.display === "none" ||
        mobileNavigationState.buttonCount !== 4 ||
        !mobileNavigationState.previewFocused ||
        !mobileNavigationState.conditionsFocused ||
        !mobileNavigationState.createEnabled ||
        !mobileNavigationState.createForwarded) {
      fail(`Mobile navigation check failed: ${JSON.stringify(mobileNavigationState)}`);
    }
    await evaluate(client, `(() => {
      document.querySelector('.mobile-nav [data-target="previewSection"]').click();
      return true;
    })()`);
    await wait(400);
    const mobileScreenshot = await captureScreenshot(client, "latest-mobile.png");

    await evaluate(client, `(() => {
      if (draftSaveTimer) clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
      draftPersistenceEnabled = false;
      const draft = JSON.parse(localStorage.getItem("grafanaBuilderDraftV1"));
      draft.updatedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      localStorage.setItem("grafanaBuilderDraftV1", JSON.stringify(draft));
      return true;
    })()`);
    const expiredReloadLoaded = new Promise((resolve) => {
      const timeout = setTimeout(resolve, browserTimeoutMs);
      client.on("Page.loadEventFired", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await client.send("Page.reload", { ignoreCache: true });
    await expiredReloadLoaded;
    await waitForBrowserCondition(
      client,
      `localStorage.getItem("grafanaBuilderDraftV1") === null && document.querySelectorAll("#panels .panel-card").length === 0`,
      "expired draft rejection"
    );
    const expiredDraftState = await evaluate(client, `(() => ({
      storageRemoved: localStorage.getItem("grafanaBuilderDraftV1") === null,
      panelCount: document.querySelectorAll("#panels .panel-card").length,
      workflowStep: document.querySelector("#workflowSteps .is-active")?.dataset.step || "",
      draftState: document.querySelector("#draftState")?.textContent || ""
    }))()`);
    if (!expiredDraftState?.storageRemoved || expiredDraftState.panelCount !== 0 || expiredDraftState.workflowStep !== "1") {
      fail(`Expired draft rejection failed: ${JSON.stringify(expiredDraftState)}`);
    }

    if (consoleErrors.length > 0 || exceptions.length > 0) {
      fail(`Console errors must be 0. errors=${JSON.stringify(consoleErrors)} exceptions=${JSON.stringify(exceptions)}`);
    }

    const evidence = {
      targetUrl,
      title: initialState.title,
      consoleErrors: 0,
      api: apiEvidence,
      desktop: desktopState,
      panelFilter: panelFilterState,
      panelOrder: panelOrderState,
      panelLimit: panelLimitState,
      addPanelFocus: addPanelFocusState,
      duplicatePanel: duplicatePanelState,
      deleteUndo: deleteUndoState,
      invalidPanelFilter: invalidPanelState,
      grafanaUrl: grafanaUrlState,
      inputConstraints: {
        core: coreInputConstraintState,
        panel: panelInputConstraintState
      },
      oidcUi: oidcUiState,
      dashboardHistory: dashboardHistoryState,
      mobile: mobileState,
      draftRestore: draftRestoreState,
      expiredDraft: expiredDraftState,
      apiFailureGuidance: apiFailureState,
      screenshots: [desktopScreenshot, dialogScreenshot, tabletScreenshot, mobileScreenshot, historyMobileScreenshot]
    };
    log(`Target screen OK: title="${initialState.title}", panels=${desktopState.previewPanelCount}, consoleErrors=0`);
    client.close();
    return evidence;
  } finally {
    await killProcess(chrome);
    await removeDirWithRetry(userDataDir);
  }
}

async function runRelatedTests() {
  const results = [];
  for (const [command, args] of relatedTests) {
    log(`Running related test: ${command} ${args.join(" ")}`);
    const startedAt = Date.now();
    const result = await runCommand(command, args);
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) console.log(output);
    results.push({
      command: [command, ...args].join(" "),
      status: "passed",
      durationMs: Date.now() - startedAt
    });
  }
  return results;
}

async function getGitSha() {
  const result = await runCommand("git", ["rev-parse", "HEAD"]);
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(sha)) fail(`Could not determine Git SHA: ${sha || "empty output"}`);
  return sha;
}

function writeVerifiedEvidence(evidence) {
  fs.mkdirSync(outputDir, { recursive: true });
  const latestPath = path.join(outputDir, "latest-result.json");
  const temporaryPath = path.join(outputDir, `latest-result.${process.pid}.tmp`);
  fs.writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, latestPath);
}

async function runOnce(attempt) {
  log(`Attempt ${attempt}/${maxRetries}`);
  const server = startDevServer();
  try {
    await waitForServer();
    log(`Dev server ready: ${targetUrl}`);
    const gitSha = await getGitSha();
    const apiEvidence = await verifyLocalApi();
    const browserEvidence = await verifyBrowser(apiEvidence);
    const relatedTestResults = await runRelatedTests();
    const evidence = {
      verifiedAt: new Date().toISOString(),
      gitSha,
      relatedTests: relatedTestResults,
      ...browserEvidence
    };
    writeVerifiedEvidence(evidence);
    log(`UI evidence: ${path.relative(repoRoot, outputDir)} (git ${gitSha})`);
    log("UI verification loop succeeded.");
  } finally {
    await killProcess(server);
  }
}

async function main() {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await runOnce(attempt);
      return;
    } catch (error) {
      lastError = error;
      console.error(`[ui-loop] Attempt ${attempt} failed: ${error.message}`);
      if (attempt < maxRetries) await wait(1000);
    }
  }
  throw lastError;
}

main().catch((error) => {
  console.error(`[ui-loop] FAILED: ${error.message}`);
  process.exit(1);
});
