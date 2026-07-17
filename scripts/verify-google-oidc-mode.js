const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

function fail(message) {
  throw new Error(message);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(port, pathname, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        let data = {};
        try { data = body ? JSON.parse(body) : {}; } catch { data = { raw: body }; }
        resolve({ statusCode: res.statusCode, data });
      });
    });
    req.once("error", reject);
    req.end(body);
  });
}

async function waitForPing(port) {
  const deadline = Date.now() + 20000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await request(port, "/api/ping");
      if (result.statusCode === 200 && result.data.ok) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`OIDC test server did not start: ${lastError?.message || "timeout"}`);
}

async function main() {
  const port = await freePort();
  const server = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      APP_AUTH_MODE: "google-oidc",
      GOOGLE_OIDC_CLIENT_ID: "test-client.apps.googleusercontent.com",
      APP_ACCESS_TOKEN: ""
    },
    stdio: "ignore"
  });

  try {
    const ping = await waitForPing(port);
    const auth = await request(port, "/api/auth-status");
    const protectedRequest = await request(port, "/api/folders", { headers: { Authorization: "Bearer invalid-token" } });
    const publicHistory = await request(port, "/api/mobile-sensor/history?limit=5");
    const protectedSensorWrite = await request(port, "/api/mobile-sensor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    if (!ping.data.ok || auth.statusCode !== 200 || auth.data.mode !== "google-oidc" ||
        !auth.data.required || auth.data.authenticated ||
        auth.data.googleOidcClientId !== "test-client.apps.googleusercontent.com" ||
        protectedRequest.statusCode !== 401 || protectedRequest.data.code !== "OIDC_AUTH_REQUIRED" ||
        publicHistory.statusCode !== 200 || !publicHistory.data.ok ||
        protectedSensorWrite.statusCode !== 401 || protectedSensorWrite.data.code !== "OIDC_AUTH_REQUIRED") {
      fail(`OIDC mode assertions failed: ${JSON.stringify({ ping, auth, protectedRequest, publicHistory, protectedSensorWrite })}`);
    }
    console.log("OK Google OIDC protects writes while allowing read-only Grafana monitoring data.");
  } finally {
    server.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
