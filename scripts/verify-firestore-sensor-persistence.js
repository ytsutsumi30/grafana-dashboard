const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const pointCollection = "mobile_sensor_points";
const latestCollection = "mobile_sensor_latest";

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

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.once("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function request(port, pathname, { method = "GET", body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const headers = body ? {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "X-App-Access-Token": "test-access-code"
    } : {};
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ statusCode: res.statusCode, data: raw ? JSON.parse(raw) : {} });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.once("error", reject);
    req.end(body);
  });
}

function fieldValue(field) {
  if (!field || typeof field !== "object") return undefined;
  for (const key of ["stringValue", "timestampValue", "integerValue", "doubleValue", "booleanValue"]) {
    if (Object.prototype.hasOwnProperty.call(field, key)) return field[key];
  }
  return undefined;
}

function collectionFromName(name) {
  return String(name).split("/documents/")[1]?.split("/")[0] || "";
}

function createMockServer() {
  const documents = new Map();
  const state = { commitCount: 0, failNextCommit: false, conflictCommitsRemaining: 0, failQueries: false, version: 0 };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/computeMetadata/v1/instance/service-accounts/default/token") {
        return sendJson(res, 200, { access_token: "metadata-token", expires_in: 3600, token_type: "Bearer" });
      }
      if (req.headers.authorization !== "Bearer test-token") {
        return sendJson(res, 401, { error: { message: "bad token" } });
      }
      if (req.method === "POST" && url.pathname.includes("/documents/") && url.searchParams.get("documentId")) {
        const body = await readJson(req);
        const name = `${decodeURIComponent(url.pathname.replace(/^\/v1\//, ""))}/${url.searchParams.get("documentId")}`;
        if (documents.has(name)) return sendJson(res, 409, { error: { message: "already exists" } });
        state.version += 1;
        const document = {
          name,
          fields: body.fields || {},
          updateTime: `2026-07-19T00:01:${String(state.version).padStart(2, "0")}.000Z`
        };
        documents.set(name, document);
        return sendJson(res, 200, document);
      }
      if (req.method === "PATCH" && url.pathname.includes("/documents/")) {
        const body = await readJson(req);
        const name = decodeURIComponent(url.pathname.replace(/^\/v1\//, ""));
        state.version += 1;
        const document = {
          name,
          fields: body.fields || {},
          updateTime: `2026-07-19T00:02:${String(state.version).padStart(2, "0")}.000Z`
        };
        documents.set(name, document);
        return sendJson(res, 200, document);
      }
      if (req.method === "DELETE" && url.pathname.includes("/documents/")) {
        const name = decodeURIComponent(url.pathname.replace(/^\/v1\//, ""));
        const current = documents.get(name);
        const expectedUpdateTime = url.searchParams.get("currentDocument.updateTime");
        if (expectedUpdateTime && current?.updateTime !== expectedUpdateTime) {
          return sendJson(res, 412, { error: { message: "delete precondition failed" } });
        }
        documents.delete(name);
        return sendJson(res, 200, {});
      }
      if (req.method === "POST" && url.pathname.endsWith("/documents:commit")) {
        state.commitCount += 1;
        const body = await readJson(req);
        if (state.failNextCommit) {
          state.failNextCommit = false;
          return sendJson(res, 503, { error: { message: "forced commit failure" } });
        }
        if (state.conflictCommitsRemaining > 0) {
          state.conflictCommitsRemaining -= 1;
          return sendJson(res, 412, { error: { message: "forced commit conflict" } });
        }
        for (const write of body.writes || []) {
          if (write.update) {
            const current = documents.get(write.update.name);
            if (write.currentDocument?.exists === false && current) {
              return sendJson(res, 412, { error: { message: "document already exists" } });
            }
            if (write.currentDocument?.updateTime && current?.updateTime !== write.currentDocument.updateTime) {
              return sendJson(res, 412, { error: { message: "update time mismatch" } });
            }
            state.version += 1;
            documents.set(write.update.name, {
              name: write.update.name,
              fields: write.update.fields,
              updateTime: `2026-07-19T00:00:${String(state.version).padStart(2, "0")}.000Z`
            });
          } else if (write.delete) {
            documents.delete(write.delete);
          }
        }
        return sendJson(res, 200, { writeResults: [], commitTime: "2026-07-19T00:00:01.000Z" });
      }
      if (req.method === "POST" && url.pathname.endsWith("/documents:runQuery")) {
        const body = await readJson(req);
        if (state.failQueries) return sendJson(res, 503, { error: { message: "forced query failure" } });
        const query = body.structuredQuery || {};
        const collection = query.from?.[0]?.collectionId;
        const filter = query.where?.fieldFilter;
        let rows = Array.from(documents.values()).filter((document) => collectionFromName(document.name) === collection);
        if (filter?.op === "EQUAL") {
          rows = rows.filter((document) => fieldValue(document.fields?.[filter.field?.fieldPath]) === fieldValue(filter.value));
        }
        if (query.orderBy?.[0]?.direction === "DESCENDING") {
          const field = query.orderBy[0].field?.fieldPath;
          rows.sort((a, b) => String(fieldValue(b.fields?.[field])).localeCompare(String(fieldValue(a.fields?.[field]))));
        }
        rows = rows.slice(0, Number(query.limit) || 500);
        return sendJson(res, 200, rows.map((document) => ({ document, readTime: "2026-07-19T00:00:02.000Z" })));
      }
      if (req.method === "GET" && url.pathname.includes("/documents/")) {
        const name = decodeURIComponent(url.pathname.replace(/^\/v1\//, ""));
        const document = documents.get(name);
        return document ? sendJson(res, 200, document) : sendJson(res, 404, { error: { message: "not found" } });
      }
      return sendJson(res, 404, { error: { message: "not found" } });
    } catch (error) {
      return sendJson(res, 500, { error: { message: error.message } });
    }
  });
  return { server, documents, state };
}

async function waitForApp(port, child, output) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`App ${port} exited early: ${output()}`);
    try {
      if ((await request(port, "/api/ping")).statusCode === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`App ${port} did not start: ${output()}`);
}

function sensorDocumentCount(documents, collection) {
  return Array.from(documents.keys()).filter((name) => collectionFromName(name) === collection).length;
}

async function main() {
  const mock = createMockServer();
  await new Promise((resolve) => mock.server.listen(0, "127.0.0.1", resolve));
  const mockOrigin = `http://127.0.0.1:${mock.server.address().port}`;
  const ports = [await freePort(), await freePort(), await freePort()];
  const outputs = ["", "", ""];
  const children = ports.map((port, index) => {
    const child = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        APP_AUTH_MODE: "access-code",
        APP_ACCESS_TOKEN: "test-access-code",
        K_SERVICE: "sensor-persistence-test",
        K_REVISION: `sensor-persistence-test-0000${index + 1}`,
        SERVICE_ROLE: index === 2 ? "admin" : "public",
        GRAFANA_SERVICE_ACCOUNT_TOKEN: "",
        GRAFANA_CLOUD_TOKEN: "",
        OPENAI_API_KEY: "",
        GRAFANA_URL: mockOrigin,
        FIRESTORE_PROJECT: "sensor-test-project",
        FIRESTORE_API_ORIGIN: mockOrigin,
        FIRESTORE_SENSOR_ENABLED: "true",
        FIRESTORE_HISTORY_ENABLED: "false",
        GOOGLE_OAUTH_ACCESS_TOKEN: "test-token"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => { outputs[index] += chunk; });
    child.stderr.on("data", (chunk) => { outputs[index] += chunk; });
    return child;
  });

  try {
    await Promise.all(ports.map((port, index) => waitForApp(port, children[index], () => outputs[index])));
    const acceptedBody = JSON.stringify({
      eventId: "sensor-persist-0001",
      deviceId: "android-persist-001",
      timestamp: "2026-07-19T00:00:00.000Z",
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      shock: false,
      tapCount: 3,
      batteryPercent: 81,
      status: "ONLINE"
    });
    const accepted = await request(ports[0], "/api/mobile-sensor", { method: "POST", body: acceptedBody });
    assert.strictEqual(accepted.statusCode, 200);
    assert.strictEqual(accepted.data.duplicate, false);
    assert.strictEqual(sensorDocumentCount(mock.documents, pointCollection), 1);
    assert.strictEqual(sensorDocumentCount(mock.documents, latestCollection), 1);

    const history = await request(ports[1], "/api/mobile-sensor/history?deviceId=android-persist-001&limit=10");
    assert.strictEqual(history.statusCode, 200);
    assert.strictEqual(history.data.source, "firestore");
    assert.strictEqual(history.data.data.length, 1);
    assert.strictEqual(history.data.data[0].eventId, "sensor-persist-0001");
    const latest = await request(ports[1], "/api/mobile-sensor/latest");
    assert.strictEqual(latest.statusCode, 200);
    assert.strictEqual(latest.data.source, "firestore");
    assert.strictEqual(latest.data.data.length, 1);
    assert.strictEqual(latest.data.data[0].deviceId, "android-persist-001");

    const newerBody = JSON.stringify({
      eventId: "sensor-persist-0002",
      deviceId: "android-persist-001",
      timestamp: "2026-07-19T00:00:10.000Z",
      accelX: 1,
      accelY: 1,
      accelZ: 10,
      status: "WARN"
    });
    assert.strictEqual((await request(ports[0], "/api/mobile-sensor", { method: "POST", body: newerBody })).statusCode, 200);
    const delayedBody = JSON.stringify({
      eventId: "sensor-persist-delayed",
      deviceId: "android-persist-001",
      timestamp: "2026-07-18T23:59:50.000Z",
      accelX: 0,
      accelY: 0,
      accelZ: 9.8,
      status: "ONLINE"
    });
    assert.strictEqual((await request(ports[0], "/api/mobile-sensor", { method: "POST", body: delayedBody })).statusCode, 200);
    const latestAfterDelayed = await request(ports[1], "/api/mobile-sensor/latest");
    assert.strictEqual(latestAfterDelayed.data.data[0].time, "2026-07-19T00:00:10.000Z");

    const commitsBeforeDuplicate = mock.state.commitCount;
    const duplicate = await request(ports[1], "/api/mobile-sensor", { method: "POST", body: acceptedBody });
    assert.strictEqual(duplicate.statusCode, 200);
    assert.strictEqual(duplicate.data.duplicate, true);
    assert.strictEqual(mock.state.commitCount, commitsBeforeDuplicate);
    assert.strictEqual(sensorDocumentCount(mock.documents, pointCollection), 3);

    mock.state.failNextCommit = true;
    const failedBody = JSON.stringify({
      eventId: "sensor-failed-0001",
      deviceId: "android-failed-001",
      timestamp: "2026-07-19T00:00:03.000Z",
      accelX: 1,
      accelY: 2,
      accelZ: 3,
      status: "WARN"
    });
    const failed = await request(ports[0], "/api/mobile-sensor", { method: "POST", body: failedBody });
    assert.strictEqual(failed.statusCode, 503);
    assert.strictEqual(failed.data.code, "SENSOR_STORE_UNAVAILABLE");
    assert.strictEqual(sensorDocumentCount(mock.documents, pointCollection), 3);
    const retried = await request(ports[1], "/api/mobile-sensor", { method: "POST", body: failedBody });
    assert.strictEqual(retried.statusCode, 200);
    assert.strictEqual(retried.data.duplicate, false);
    assert.strictEqual(sensorDocumentCount(mock.documents, pointCollection), 4);

    mock.state.failNextCommit = true;
    const failedWithoutEventId = await request(ports[0], "/api/mobile-sensor", {
      method: "POST",
      body: JSON.stringify({
        deviceId: "android-failed-no-id",
        timestamp: "2026-07-19T00:00:04.000Z",
        accelX: 2,
        accelY: 2,
        accelZ: 2,
        status: "WARN"
      })
    });
    assert.strictEqual(failedWithoutEventId.statusCode, 503);
    assert.strictEqual(failedWithoutEventId.data.code, "SENSOR_STORE_UNAVAILABLE");
    assert.strictEqual(sensorDocumentCount(mock.documents, pointCollection), 4);

    const conflictBody = JSON.stringify({
      eventId: "sensor-conflict-retry",
      deviceId: "android-conflict-001",
      timestamp: "2026-07-19T00:00:05.000Z",
      accelX: 3,
      accelY: 3,
      accelZ: 3,
      status: "WARN"
    });
    mock.state.conflictCommitsRemaining = 3;
    const conflicted = await request(ports[0], "/api/mobile-sensor", { method: "POST", body: conflictBody });
    assert.strictEqual(conflicted.statusCode, 409);
    assert.strictEqual(conflicted.data.code, "SENSOR_STORE_CONFLICT");
    const conflictRetry = await request(ports[1], "/api/mobile-sensor", { method: "POST", body: conflictBody });
    assert.strictEqual(conflictRetry.statusCode, 200);
    assert.strictEqual(conflictRetry.data.duplicate, false);

    mock.state.failQueries = true;
    const latestMemoryFallback = await request(ports[0], "/api/mobile-sensor/latest");
    assert.strictEqual(latestMemoryFallback.data.source, "memory");
    assert.strictEqual(
      latestMemoryFallback.data.data.find((row) => row.deviceId === "android-persist-001").time,
      "2026-07-19T00:00:10.000Z"
    );
    const orderedMemoryHistory = await request(ports[0], "/api/mobile-sensor/history?deviceId=android-persist-001&limit=10");
    assert.strictEqual(orderedMemoryHistory.data.source, "memory");
    assert.strictEqual(orderedMemoryHistory.data.data.at(-1).time, "2026-07-19T00:00:10.000Z");
    const memoryFallback = await request(ports[0], "/api/mobile-sensor/history?deviceId=android-failed-no-id&limit=10");
    assert.strictEqual(memoryFallback.statusCode, 200);
    assert.strictEqual(memoryFallback.data.source, "memory");
    assert.strictEqual(memoryFallback.data.data.length, 0);
    assert.match(memoryFallback.data.warning, /forced query failure/);
    mock.state.failQueries = false;

    for (let index = 0; index < 451; index += 1) {
      const name = `projects/sensor-test-project/databases/(default)/documents/${pointCollection}/bulk-${index}`;
      mock.documents.set(name, {
        name,
        fields: {
          deviceId: { stringValue: "android-persist-001" },
          time: { timestampValue: "2026-07-19T00:00:00.000Z" }
        }
      });
    }

    const reset = await request(ports[2], "/api/mobile-sensor/reset", {
      method: "POST",
      body: JSON.stringify({ deviceId: "android-persist-001" })
    });
    assert.strictEqual(reset.statusCode, 200);
    const resetHistory = await request(ports[1], "/api/mobile-sensor/history?deviceId=android-persist-001&limit=10");
    assert.strictEqual(resetHistory.data.data.length, 0);
    const resetAll = await request(ports[2], "/api/mobile-sensor/reset", {
      method: "POST",
      body: JSON.stringify({})
    });
    assert.strictEqual(resetAll.statusCode, 200);
    assert.strictEqual(sensorDocumentCount(mock.documents, pointCollection), 0);
    assert.strictEqual(sensorDocumentCount(mock.documents, latestCollection), 0);
  } finally {
    children.forEach((child) => child.kill());
    await Promise.all(children.map((child) => child.exitCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", resolve))));
    mock.server.closeAllConnections?.();
    await new Promise((resolve) => mock.server.close(resolve));
  }

  console.log("OK Firestore sensor persistence works across instances and rejects failed writes.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
