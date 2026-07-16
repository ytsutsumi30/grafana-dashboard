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
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
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
    env: { ...process.env, HOST: host, PORT: String(port) },
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

async function verifyBrowser() {
  const chromePath = findChrome();
  const debugPort = await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "grafana-ui-verify-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "ignore"] });

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
    await client.send("Page.navigate", { url: targetUrl });
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, browserTimeoutMs);
      client.on("Page.loadEventFired", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await wait(1000);

    const evaluation = await client.send("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => ({
        title: document.title,
        h1: document.querySelector("h1")?.innerText || "",
        hasIndustry: Boolean(document.querySelector("#industry")),
        hasDashboardType: Boolean(document.querySelector("#dashboardType")),
        hasPropose: Boolean(document.querySelector("#propose")),
        hasCreate: Boolean(document.querySelector("#create")),
        bodyText: document.body.innerText.slice(0, 500)
      }))()`
    });
    const value = evaluation.result?.value || {};

    client.close();

    if (value.title !== "Grafana Cloud ダッシュボード提案ツール") {
      fail(`Unexpected page title: ${value.title}`);
    }
    if (!String(value.h1).includes("Grafana Cloud")) fail("Target screen h1 was not rendered.");
    if (!value.hasIndustry || !value.hasDashboardType || !value.hasPropose || !value.hasCreate) {
      fail(`Target screen required controls missing: ${JSON.stringify(value)}`);
    }
    if (consoleErrors.length > 0 || exceptions.length > 0) {
      fail(`Console errors must be 0. errors=${JSON.stringify(consoleErrors)} exceptions=${JSON.stringify(exceptions)}`);
    }

    log(`Target screen OK: title="${value.title}", consoleErrors=0`);
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
    await verifyBrowser();
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
