const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { ApiError, IdempotencyStore, fetchWithTimeout } = require("../server/api-safety");

const root = path.resolve(__dirname, "..");

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
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }
        resolve({ statusCode: res.statusCode, data });
      });
    });
    req.once("error", reject);
    req.end(body);
  });
}

async function waitForServer(port, processOutput) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, "/api/ping");
      if (response.statusCode === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API safety test server did not start: ${processOutput()}`);
}

async function verifyFetchTimeout() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.flushHeaders();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await assert.rejects(
      async () => {
        const response = await fetchWithTimeout(`http://127.0.0.1:${port}/hang`, { timeoutMs: 50 });
        await response.text();
      },
      (error) => error instanceof ApiError && error.statusCode === 504 && error.code === "UPSTREAM_TIMEOUT"
    );
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  await verifyFetchTimeout();

  const store = new IdempotencyStore({ ttlMs: 10000 });
  let calls = 0;
  const first = await store.run("test", "12345678", "same", async () => ++calls);
  const replay = await store.run("test", "12345678", "same", async () => ++calls);
  assert.deepStrictEqual(first, { value: 1, replayed: false });
  assert.deepStrictEqual(replay, { value: 1, replayed: true });
  assert.strictEqual(calls, 1);
  await assert.rejects(
    () => store.run("test", "12345678", "different", async () => 2),
    (error) => error.statusCode === 409 && error.code === "IDEMPOTENCY_KEY_REUSED"
  );

  const port = await freePort();
  let output = "";
  const server = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", APP_AUTH_MODE: "none", K_SERVICE: "", K_REVISION: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitForServer(port, () => output);

    const noContentType = await request(port, "/api/mobile-sensor", { method: "POST", body: "{}" });
    assert.strictEqual(noContentType.statusCode, 415);
    assert.strictEqual(noContentType.data.code, "CONTENT_TYPE_REQUIRED");

    const invalidJson = await request(port, "/api/mobile-sensor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    });
    assert.strictEqual(invalidJson.statusCode, 400);
    assert.strictEqual(invalidJson.data.code, "INVALID_JSON");

    const arrayJson = await request(port, "/api/mobile-sensor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]"
    });
    assert.strictEqual(arrayJson.statusCode, 400);
    assert.strictEqual(arrayJson.data.code, "JSON_OBJECT_REQUIRED");

    const invalidProposal = await request(port, "/api/propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ industry: "", dashboardType: "manufacturing" })
    });
    assert.strictEqual(invalidProposal.statusCode, 400);
    assert.strictEqual(invalidProposal.data.code, "INVALID_INPUT");

    const missingKey = await request(port, "/api/create-dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ industry: "Press", dashboardType: "manufacturing" })
    });
    assert.strictEqual(missingKey.statusCode, 400);
    assert.strictEqual(missingKey.data.code, "IDEMPOTENCY_KEY_REQUIRED");

    const sensorPayload = {
      eventId: "sensor-event-0001",
      deviceId: "android-test-001",
      timestamp: new Date().toISOString(),
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      accelMagnitude: 9.803,
      shock: false,
      tapCount: 0,
      batteryPercent: 80,
      status: "ONLINE"
    };
    const postOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sensorPayload)
    };
    const accepted = await request(port, "/api/mobile-sensor", postOptions);
    const duplicate = await request(port, "/api/mobile-sensor", postOptions);
    assert.strictEqual(accepted.statusCode, 200);
    assert.strictEqual(accepted.data.duplicate, false);
    assert.strictEqual(duplicate.statusCode, 200);
    assert.strictEqual(duplicate.data.duplicate, true);
    const history = await request(port, "/api/mobile-sensor/history?deviceId=android-test-001&limit=10");
    assert.strictEqual(history.data.data.length, 1);
  } finally {
    server.kill();
  }

  console.log("OK API timeout, validation, and idempotency safety.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
