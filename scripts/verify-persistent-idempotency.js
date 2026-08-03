const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

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

function readRequestBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
  });
}

function send(res, statusCode, payload = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function request(port, pathname, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, method, headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, data: raw ? JSON.parse(raw) : {} }));
    });
    req.once("error", reject);
    req.end(body);
  });
}

async function waitForApp(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await request(port, "/api/ping");
      if (response.statusCode === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`App server ${port} did not start.`);
}

async function main() {
  const firestoreDocuments = new Map();
  const grafanaDashboards = new Map();
  let dashboardWrites = 0;
  let completionFailuresRemaining = 1;
  let completionAttempts = 0;
  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/v1/projects/")) {
      const marker = "/documents/api_idempotency";
      const markerIndex = url.pathname.indexOf(marker);
      const trailing = markerIndex >= 0 ? url.pathname.slice(markerIndex + marker.length).replace(/^\//, "") : "";
      const documentId = trailing || url.searchParams.get("documentId") || "";
      if (req.method === "POST") {
        if (firestoreDocuments.has(documentId)) return send(res, 409, { error: { message: "already exists" } });
        const body = await readRequestBody(req);
        firestoreDocuments.set(documentId, body);
        return send(res, 200, body);
      }
      if (req.method === "GET") {
        return firestoreDocuments.has(documentId)
          ? send(res, 200, firestoreDocuments.get(documentId))
          : send(res, 404, { error: { message: "not found" } });
      }
      if (req.method === "PATCH") {
        completionAttempts += 1;
        if (completionFailuresRemaining > 0) {
          completionFailuresRemaining -= 1;
          return send(res, 500, { error: { message: "transient completion failure" } });
        }
        const body = await readRequestBody(req);
        firestoreDocuments.set(documentId, body);
        return send(res, 200, body);
      }
      if (req.method === "DELETE") {
        firestoreDocuments.delete(documentId);
        return send(res, 200, {});
      }
    }
    if (req.method === "GET" && url.pathname === "/api/datasources/uid/testdata") return send(res, 200, { uid: "testdata" });
    if (req.method === "GET" && url.pathname.startsWith("/api/dashboards/uid/")) {
      const uid = decodeURIComponent(url.pathname.split("/").pop());
      return grafanaDashboards.has(uid)
        ? send(res, 200, { dashboard: grafanaDashboards.get(uid), meta: { url: `/d/${uid}/demo` } })
        : send(res, 404, { message: "Dashboard not found" });
    }
    if (req.method === "POST" && url.pathname === "/api/dashboards/db") {
      const body = await readRequestBody(req);
      dashboardWrites += 1;
      grafanaDashboards.set(body.dashboard.uid, body.dashboard);
      return send(res, 200, { uid: body.dashboard.uid, url: `/d/${body.dashboard.uid}/demo`, status: "success" });
    }
    send(res, 404, { message: "not found" });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));

  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const ports = [await freePort(), await freePort()];
  const children = ports.map((port, index) => spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      K_SERVICE: "persistent-idempotency-test",
      K_REVISION: `persistent-idempotency-test-${index}`,
      SERVICE_ROLE: "admin",
      APP_AUTH_MODE: "access-code",
      APP_ACCESS_TOKEN: "test-access-code",
      GRAFANA_URL: upstreamUrl,
      GRAFANA_SERVICE_ACCOUNT_TOKEN: "test-grafana-token",
      FIRESTORE_PROJECT: "test-project",
      FIRESTORE_API_ORIGIN: upstreamUrl,
      GOOGLE_OAUTH_ACCESS_TOKEN: "test-google-token",
      FIRESTORE_HISTORY_ENABLED: "false"
    },
    stdio: "ignore"
  }));

  try {
    await Promise.all(ports.map(waitForApp));
    const headers = {
      "Content-Type": "application/json",
      "X-App-Access-Token": "test-access-code",
      "Idempotency-Key": "dashboard-shared-key-0001"
    };
    const body = JSON.stringify({ industry: "Press", dashboardType: "manufacturing", overwrite: false });
    const created = await Promise.all(ports.map((port) => request(port, "/api/create-dashboard", { method: "POST", headers, body })));
    assert.ok(created.every((response) => response.statusCode === 200), JSON.stringify(created));
    assert.strictEqual(dashboardWrites, 1);
    assert.ok(completionAttempts >= 2, "Firestore completion should retry after a transient failure");
    assert.deepStrictEqual(created.map((response) => response.data.idempotencyReplayed).sort(), [false, true]);

  } finally {
    children.forEach((child) => child.kill());
    upstream.closeAllConnections?.();
    await new Promise((resolve) => upstream.close(resolve));
  }

  console.log("OK dashboard idempotency is shared across Cloud Run admin instances.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
