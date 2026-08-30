const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const deploySource = fs.readFileSync(path.join(root, "scripts", "deploy-cloud-run.ps1"), "utf8");

assert.match(deploySource, /\[ValidateSet\("admin", "public"\)\]/);
assert.match(deploySource, /SERVICE_ROLE=\$ServiceRole/);
assert.match(deploySource, /\$ServiceRole -eq "admin"/);
assert.match(deploySource, /GRAFANA_SERVICE_ACCOUNT_TOKEN,OPENAI_API_KEY,APP_ACCESS_TOKEN/);
assert.match(deploySource, /EnableFirestoreSensorData is required for the public API service/);
assert.match(deploySource, /ServiceAccount is required so admin and public services cannot share the default identity/);
assert.match(deploySource, /Assert-PublicServiceAccountLeastPrivilege/);
assert.match(deploySource, /roles\/secretmanager\.secretAccessor/);
assert.match(deploySource, /roles\/aiplatform\.user/);
assert.match(deploySource, /public least privilege was not proven/);
assert.doesNotMatch(deploySource, /if \(\$LASTEXITCODE -ne 0\) \{ continue \}/);

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

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body || "";
    const headers = { ...(options.headers || {}) };
    if (body) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method: options.method || "GET", headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let data = raw;
        try { data = raw ? JSON.parse(raw) : {}; } catch {}
        resolve({ statusCode: res.statusCode, data });
      });
    });
    req.once("error", reject);
    req.end(body);
  });
}

async function startApp(environment) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      APP_AUTH_MODE: "access-code",
      APP_ACCESS_TOKEN: "role-test-token",
      GRAFANA_SERVICE_ACCOUNT_TOKEN: "",
      GRAFANA_CLOUD_TOKEN: "",
      OPENAI_API_KEY: "",
      K_SERVICE: "",
      K_REVISION: "",
      ...environment
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try {
      if ((await request(port, "/api/ping")).statusCode === 200) return { child, port };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error(`Server did not start: ${output}`);
}

async function expectStartupFailure(environment, pattern) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup failure timed out: ${output}`)), 5000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
  });
  assert.match(output, pattern);
}

async function main() {
  const publicApp = await startApp({ SERVICE_ROLE: "public", APP_RATE_LIMIT_MAX_REQUESTS: "1" });
  const adminApp = await startApp({ SERVICE_ROLE: "admin" });
  try {
    assert.strictEqual((await request(publicApp.port, "/")).statusCode, 404);
    assert.strictEqual((await request(publicApp.port, "/api/auth-status")).statusCode, 404);
    assert.strictEqual((await request(publicApp.port, "/api/folders")).statusCode, 404);
    const companyBody = JSON.stringify({ keywords: ["metal processing"], aiConsent: true });
    assert.strictEqual((await request(publicApp.port, "/api/analyze-company-sources", { method: "POST", body: companyBody })).statusCode, 404);
    assert.strictEqual((await request(publicApp.port, "/api/mobile-sensor/history?limit=5")).statusCode, 200);

    const sensorBody = JSON.stringify({ deviceId: "role-test-device", accelX: 0, accelY: 0, accelZ: 9.8 });
    const authHeaders = { "X-App-Access-Token": "role-test-token" };
    assert.strictEqual((await request(publicApp.port, "/api/mobile-sensor", { method: "POST", body: sensorBody })).statusCode, 401);
    assert.strictEqual((await request(publicApp.port, "/api/mobile-sensor", { method: "POST", body: sensorBody, headers: authHeaders })).statusCode, 200);
    assert.strictEqual((await request(publicApp.port, "/api/mobile-sensor", { method: "POST", body: sensorBody, headers: authHeaders })).statusCode, 429);

    assert.strictEqual((await request(adminApp.port, "/")).statusCode, 200);
    assert.strictEqual((await request(adminApp.port, "/api/auth-status")).statusCode, 200);
    assert.strictEqual((await request(adminApp.port, "/api/analyze-company-sources", { method: "POST", body: companyBody })).statusCode, 401);
    assert.strictEqual((await request(adminApp.port, "/api/analyze-company-sources", { method: "POST", body: companyBody, headers: authHeaders })).statusCode, 200);
    assert.strictEqual((await request(adminApp.port, "/api/mobile-sensor/history?limit=5")).statusCode, 404);
    assert.strictEqual((await request(adminApp.port, "/api/mobile-sensor", { method: "POST", body: sensorBody, headers: authHeaders })).statusCode, 404);
  } finally {
    publicApp.child.kill();
    adminApp.child.kill();
  }

  await expectStartupFailure({
    K_SERVICE: "combined-test",
    K_REVISION: "combined-test-00001",
    SERVICE_ROLE: "combined",
    APP_AUTH_MODE: "access-code",
    APP_ACCESS_TOKEN: "test",
    FIRESTORE_PROJECT: "role-test-project"
  }, /SERVICE_ROLE=combined is not allowed on Cloud Run/);

  await expectStartupFailure({
    SERVICE_ROLE: "public",
    APP_AUTH_MODE: "access-code",
    APP_ACCESS_TOKEN: "test",
    GRAFANA_SERVICE_ACCOUNT_TOKEN: "must-not-be-present"
  }, /Public API service must not receive Grafana or OpenAI secrets/);

  await expectStartupFailure({
    K_SERVICE: "public-test",
    K_REVISION: "public-test-00001",
    SERVICE_ROLE: "public",
    APP_AUTH_MODE: "access-code",
    APP_ACCESS_TOKEN: "test",
    FIRESTORE_PROJECT: "role-test-project",
    FIRESTORE_SENSOR_ENABLED: "false",
    GRAFANA_SERVICE_ACCOUNT_TOKEN: "",
    GRAFANA_CLOUD_TOKEN: "",
    OPENAI_API_KEY: ""
  }, /FIRESTORE_SENSOR_ENABLED=true is required/);

  console.log("OK public and admin API services expose separate route and secret boundaries.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
