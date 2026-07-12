#!/usr/bin/env node

const { spawn } = require("node:child_process");
const fs = require("node:fs");
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
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--show-browser") result.showBrowser = true;
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
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
