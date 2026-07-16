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
  if (proposal.statusCode !== 200 || proposal.data?.source !== "template" || proposal.data?.panels?.length < 8) {
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
        hasPropose: Boolean(document.querySelector("#propose")),
        hasCreate: Boolean(document.querySelector("#create")),
        hasDiscardDraft: Boolean(document.querySelector("#discardDraft")),
        hasDraftState: Boolean(document.querySelector("#draftState")),
        workflowStepCount: document.querySelectorAll("#workflowSteps [data-step]").length,
        toolSectionCount: document.querySelectorAll("details.tool-section").length,
        openToolSectionCount: document.querySelectorAll("details.tool-section[open]").length,
        bodyText: document.body.innerText.slice(0, 500)
      }))()`) || {};

    if (initialState.title !== "Grafana Cloud ダッシュボード提案ツール") {
      fail(`Unexpected page title: ${initialState.title}`);
    }
    if (!String(initialState.h1).includes("Grafana Cloud")) fail("Target screen h1 was not rendered.");
    if (!initialState.hasIndustry || !initialState.hasDashboardType || !initialState.hasPropose || !initialState.hasCreate || !initialState.hasDiscardDraft || !initialState.hasDraftState) {
      fail(`Target screen required controls missing: ${JSON.stringify(initialState)}`);
    }
    if (initialState.workflowStepCount !== 3) fail(`Expected 3 workflow steps, found ${initialState.workflowStepCount}.`);
    if (initialState.toolSectionCount < 6) fail(`Expected at least 6 collapsible tool sections, found ${initialState.toolSectionCount}.`);
    if (initialState.openToolSectionCount > 1) fail("Auxiliary tool sections must be collapsed except the creation history section.");

    await evaluate(client, `(() => {
      document.querySelector("#industry").value = "板金加工業者";
      document.querySelector("#dashboardType").value = "manufacturing";
      document.querySelector("#propose").click();
      return true;
    })()`);
    await waitForBrowserCondition(
      client,
      `document.querySelectorAll("#previewBoard .preview-panel").length >= 8 && !document.querySelector("#propose").disabled`,
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
        activeStep,
        appColumns: getComputedStyle(app).gridTemplateColumns,
        asideWidth: Math.round(aside.getBoundingClientRect().width),
        mainWidth: Math.round(main.getBoundingClientRect().width),
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    })()`) || {};
    if (desktopState.previewPanelCount < 8 || desktopState.panelCardCount < 8) {
      fail(`Proposal did not render enough panels: ${JSON.stringify(desktopState)}`);
    }
    if (desktopState.activeStep !== "2") fail(`Workflow must advance to step 2 after proposal: ${JSON.stringify(desktopState)}`);
    if (desktopState.asideWidth < 300 || desktopState.mainWidth < 700 || desktopState.documentOverflow) {
      fail(`Desktop layout check failed: ${JSON.stringify(desktopState)}`);
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
    if (draftRestoreState.panelCount < 8 || draftRestoreState.activeStep !== "2" || draftRestoreState.accessTokenRestored) {
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
    const desktopScreenshot = await captureScreenshot(client, "latest-desktop.png");

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
      return {
        appColumns: getComputedStyle(app).gridTemplateColumns,
        asideWidth: Math.round(aside.getBoundingClientRect().width),
        mainWidth: Math.round(main.getBoundingClientRect().width),
        viewportWidth: document.documentElement.clientWidth,
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        previewScrollable: preview.scrollWidth > preview.clientWidth
      };
    })()`) || {};
    if (mobileState.asideWidth > mobileState.viewportWidth || mobileState.mainWidth > mobileState.viewportWidth) {
      fail(`Mobile content exceeds viewport: ${JSON.stringify(mobileState)}`);
    }
    if (mobileState.documentOverflow || !mobileState.previewScrollable) {
      fail(`Mobile overflow containment check failed: ${JSON.stringify(mobileState)}`);
    }
    const mobileScreenshot = await captureScreenshot(client, "latest-mobile.png");

    if (consoleErrors.length > 0 || exceptions.length > 0) {
      fail(`Console errors must be 0. errors=${JSON.stringify(consoleErrors)} exceptions=${JSON.stringify(exceptions)}`);
    }

    const evidence = {
      verifiedAt: new Date().toISOString(),
      targetUrl,
      title: initialState.title,
      consoleErrors: 0,
      api: apiEvidence,
      desktop: desktopState,
      mobile: mobileState,
      draftRestore: draftRestoreState,
      apiFailureGuidance: apiFailureState,
      screenshots: [desktopScreenshot, mobileScreenshot]
    };
    fs.writeFileSync(path.join(outputDir, "latest-result.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    log(`Target screen OK: title="${initialState.title}", panels=${desktopState.previewPanelCount}, consoleErrors=0`);
    log(`UI evidence: ${path.relative(repoRoot, outputDir)}`);
    client.close();
  } finally {
    await killProcess(chrome);
    await removeDirWithRetry(userDataDir);
  }
}

async function runRelatedTests() {
  for (const [command, args] of relatedTests) {
    log(`Running related test: ${command} ${args.join(" ")}`);
    const result = await runCommand(command, args);
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) console.log(output);
  }
}

async function runOnce(attempt) {
  log(`Attempt ${attempt}/${maxRetries}`);
  const server = startDevServer();
  try {
    await waitForServer();
    log(`Dev server ready: ${targetUrl}`);
    const apiEvidence = await verifyLocalApi();
    await verifyBrowser(apiEvidence);
    await runRelatedTests();
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
