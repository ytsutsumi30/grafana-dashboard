#!/usr/bin/env node

const { spawn } = require("node:child_process");

class JsonLineMcpClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.stderr = "";
    const env = { ...process.env, BROWSER_CHANNEL: process.env.BROWSER_CHANNEL || "chromium" };
    this.child = spawn("cmd.exe", ["/d", "/s", "/c", "npx notebooklm-mcp@latest"], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk.toString();
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

  request(method, params = {}, timeoutMs = 60000) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}. ${this.stderr}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  close() {
    this.child.kill();
  }
}

function parseToolResult(result) {
  const text = (result?.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text || result;
  }
}

async function main() {
  const client = new JsonLineMcpClient();
  try {
    await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "grafana-dashboard-notebooklm-auth", version: "1.0.0" },
    });
    client.notify("notifications/initialized");

    const health = parseToolResult(
      await client.request("tools/call", { name: "get_health", arguments: {} })
    );
    if (health?.data?.authenticated) {
      console.log("NotebookLM MCP is already authenticated.");
      return;
    }

    const setup = parseToolResult(
      await client.request(
        "tools/call",
        {
          name: "setup_auth",
          arguments: {
            show_browser: true,
            browser_options: { show: true, headless: false, timeout_ms: 30000 },
          },
        },
        660000
      )
    );
    console.log(JSON.stringify(setup, null, 2));
    console.log("Complete Google login in the opened browser, then rerun the source sync command.");
  } finally {
    client.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
