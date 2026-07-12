#!/usr/bin/env node

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_NOTEBOOK_URL =
  "https://notebooklm.google.com/notebook/e6ec4685-1b9b-47ab-a7fd-d4464e1a2324";
const DEFAULT_NOTEBOOK_ID = "";
const DEFAULT_MANIFEST = path.join("docs", "notebooklm-source-manifest.json");

function parseArgs(argv) {
  const result = {
    notebookId: DEFAULT_NOTEBOOK_ID,
    notebookUrl: DEFAULT_NOTEBOOK_URL,
    manifestPath: DEFAULT_MANIFEST,
    dryRun: false,
    showBrowser: false,
    startAt: "",
    limit: 0,
    directUi: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--show-browser") result.showBrowser = true;
    else if (arg === "--direct-ui") result.directUi = true;
    else if (arg === "--notebook-id") result.notebookId = argv[++i];
    else if (arg === "--notebook-url") result.notebookUrl = argv[++i];
    else if (arg === "--manifest") result.manifestPath = argv[++i];
    else if (arg === "--start-at") result.startAt = argv[++i];
    else if (arg === "--limit") result.limit = Number.parseInt(argv[++i], 10);
    else if (arg === "--help") {
      console.log(`Usage:
  node scripts/sync-notebooklm-mcp-sources.js [options]

Options:
  --dry-run                 Print sources without uploading
  --show-browser            Show NotebookLM browser automation
  --direct-ui               Upload through NotebookLM UI instead of MCP add_source
  --notebook-id <id>        NotebookLM MCP library notebook id
  --notebook-url <url>      Direct NotebookLM URL
  --manifest <path>         Source manifest path
  --start-at <path>         Skip sources before this relative path
  --limit <count>           Add at most this many sources
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function findNodeModule(moduleName) {
  try {
    return require(moduleName);
  } catch {
    // Continue to npx cache lookup.
  }

  const npxRoot = path.join(process.env.LOCALAPPDATA || "", "npm-cache", "_npx");
  if (!fs.existsSync(npxRoot)) {
    throw new Error(`${moduleName} was not found. Run: npx notebooklm-mcp@latest`);
  }

  const stack = [npxRoot];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === moduleName && fullPath.includes(`${path.sep}node_modules${path.sep}`)) {
        return require(fullPath);
      }
      if (entry.name === "node_modules" || !current.includes(`${path.sep}node_modules${path.sep}`)) {
        stack.push(fullPath);
      }
    }
  }

  throw new Error(`${moduleName} was not found under ${npxRoot}`);
}

function killNotebookLmChromeProcesses() {
  if (process.platform !== "win32") return;
  spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "$p = Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" | Where-Object { $_.CommandLine -like '*notebooklm-mcp*' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
  ], { stdio: "ignore" });
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function selectSourceWindow(sources, options) {
  let selected = sources;
  if (options.startAt) {
    const index = selected.findIndex((source) => source.relativePath === options.startAt);
    if (index < 0) throw new Error(`--start-at was not found in manifest: ${options.startAt}`);
    selected = selected.slice(index);
  }
  if (options.limit > 0) selected = selected.slice(0, options.limit);
  return selected;
}

function readManifest(repoRoot, manifestPath) {
  const fullPath = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(repoRoot, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  return {
    manifest,
    fullPath,
    sources: (manifest.sources || []).filter((source) => source.exists),
  };
}

class JsonLineMcpClient {
  constructor(command, args) {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    const env = { ...process.env, BROWSER_CHANNEL: process.env.BROWSER_CHANNEL || "chromium" };
    this.child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env });
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
    });
    this.child.on("exit", (code) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`MCP server exited with code ${code}: ${this.stderr}`));
      }
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (!message.id || !this.pending.has(message.id)) continue;
      const { resolve, reject, timeout } = this.pending.get(message.id);
      clearTimeout(timeout);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  }

  request(method, params = {}, timeoutMs = 120000) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}. ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${payload}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  close() {
    this.child.kill();
  }
}

function extractToolText(result) {
  const text = (result?.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function ensureNotebook(client, options) {
  if (options.notebookId) return options.notebookId;

  const added = extractToolText(
    await client.request(
      "tools/call",
      {
        name: "add_notebook",
        arguments: {
          url: options.notebookUrl,
          name: "Grafana Dashboard Builder PoC",
          description:
            "Grafana Cloud, Cloud Run, Android sensor demo, and manufacturing dashboard builder documentation.",
          topics: [
            "Grafana dashboards",
            "Manufacturing monitoring",
            "IoT device monitoring",
            "Cloud Run",
            "NotebookLM integration",
          ],
          content_types: ["documentation", "runbooks", "implementation notes"],
          use_cases: [
            "Review Grafana dashboard builder specifications",
            "Plan manufacturing monitoring dashboard improvements",
            "Explain sales demo operations",
          ],
          tags: ["grafana", "manufacturing", "cloud-run", "notebooklm"],
        },
      },
      60000
    )
  );
  const id = added?.data?.notebook?.id;
  if (!id) throw new Error(`Could not register notebook URL: ${JSON.stringify(added)}`);
  await client.request("tools/call", { name: "select_notebook", arguments: { id } }, 60000);
  return id;
}

async function fillTextareaWithEvents(page, selector, value) {
  await page.locator(selector).first().waitFor({ state: "visible", timeout: 30000 });
  await page.locator(selector).first().evaluate((element, text) => {
    element.focus();
    element.value = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function openCopiedTextDialog(page, notebookUrl) {
  const url = notebookUrl.includes("?")
    ? `${notebookUrl}&addSource=true`
    : `${notebookUrl}?addSource=true`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);

  const copiedTextButton = page
    .locator("mat-dialog-container button, [role='dialog'] button, .cdk-overlay-pane button")
    .filter({ hasText: "コピーしたテキスト" })
    .first();
  if (await copiedTextButton.isVisible({ timeout: 5000 }).catch(() => false)) {
    await copiedTextButton.click();
    return;
  }

  await page
    .locator("button.add-source-button, button[aria-label*='ソースを追加'], button[aria-label*='Add source']")
    .first()
    .click({ timeout: 10000 });
  await page
    .locator("mat-dialog-container button, [role='dialog'] button, .cdk-overlay-pane button")
    .filter({ hasText: "コピーしたテキスト" })
    .first()
    .click({ timeout: 10000 });
}

async function uploadSourcesViaNotebookUi(repoRoot, options, sources) {
  const { chromium } = findNodeModule("patchright");
  killNotebookLmChromeProcesses();
  await wait(2500);

  const profile = path.join(os.homedir(), "AppData", "Local", "notebooklm-mcp", "Data", "chrome_profile");
  const context = await chromium.launchPersistentContext(profile, {
    channel: process.env.BROWSER_CHANNEL || "chromium",
    headless: !options.showBrowser,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();

  try {
    for (const source of sources) {
      const sourcePath = path.join(repoRoot, source.relativePath);
      const title = `Grafana Project - ${source.relativePath.replace(/\\/g, "/")}`;
      const content = fs.readFileSync(sourcePath, "utf8");
      const sourceText = `${title}\n\n${content}`;

      console.log(`Adding source via UI: ${title}`);
      await openCopiedTextDialog(page, options.notebookUrl);
      await page.waitForTimeout(1000);
      await fillTextareaWithEvents(page, "textarea[aria-label='貼り付けたテキスト']", sourceText);

      const insertButton = page
        .locator("mat-dialog-container button, [role='dialog'] button, .cdk-overlay-pane button")
        .filter({ hasText: "挿入" })
        .first();
      await insertButton.waitFor({ state: "visible", timeout: 10000 });
      await insertButton.click({ timeout: 10000 });
      await page.waitForTimeout(8000);
    }
  } finally {
    await context.close();
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest(repoRoot, options.manifestPath);
  const sources = selectSourceWindow(manifest.sources, options);

  console.log(`Manifest: ${manifest.fullPath}`);
  console.log(`Notebook: ${options.notebookId || options.notebookUrl}`);
  console.log(`Sources: ${sources.length}`);

  if (options.dryRun) {
    for (const source of sources) console.log(`DRY-RUN ${source.relativePath}`);
    return;
  }

  if (options.directUi) {
    await uploadSourcesViaNotebookUi(repoRoot, options, sources);
    console.log("NotebookLM UI source sync completed.");
    return;
  }

  const client = new JsonLineMcpClient("cmd.exe", [
    "/d",
    "/s",
    "/c",
    "npx notebooklm-mcp@latest",
  ]);

  try {
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "grafana-dashboard-notebooklm-sync", version: "1.0.0" },
    });
    client.notify("notifications/initialized");

    const health = extractToolText(
      await client.request("tools/call", { name: "get_health", arguments: {} }, 60000)
    );
    if (!health?.success || !health?.data?.authenticated) {
      throw new Error("NotebookLM MCP is not authenticated. Run setup_auth from the MCP tool first.");
    }

    const notebookId = await ensureNotebook(client, options);
    console.log(`Using NotebookLM MCP library id: ${notebookId}`);

    for (const source of sources) {
      const sourcePath = path.join(repoRoot, source.relativePath);
      const content = fs.readFileSync(sourcePath, "utf8");
      const title = `Grafana Project - ${source.relativePath.replace(/\\/g, "/")}`;
      console.log(`Adding source: ${title}`);
      const result = extractToolText(
        await client.request(
          "tools/call",
          {
            name: "add_source",
            arguments: {
              type: "text",
              title,
              content,
              notebook_id: notebookId,
              show_browser: options.showBrowser,
            },
          },
          180000
        )
      );
      if (!result?.success) {
        throw new Error(`Failed to add ${source.relativePath}: ${JSON.stringify(result)}`);
      }
    }

    console.log("NotebookLM MCP source sync completed.");
  } catch (error) {
    console.warn(`${error.message}`);
    console.warn("Falling back to direct NotebookLM UI upload.");
    client.close();
    await uploadSourcesViaNotebookUi(repoRoot, options, sources);
    console.log("NotebookLM UI source sync completed.");
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
