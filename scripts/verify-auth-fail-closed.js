const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

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

function baseEnvironment(port) {
  return {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    K_SERVICE: "auth-verification-service",
    K_REVISION: "auth-verification-service-00001-test",
    SERVICE_ROLE: "admin",
    FIRESTORE_PROJECT: "auth-verification-project",
    APP_ACCESS_TOKEN: "",
    GOOGLE_OIDC_CLIENT_ID: "",
    GOOGLE_OIDC_ALLOWED_EMAILS: "",
    GOOGLE_OIDC_ALLOWED_DOMAINS: ""
  };
}

async function expectStartupFailure(env, expectedMessage) {
  const child = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const exitCode = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Expected startup failure timed out.")), 5000))
  ]);
  assert.notStrictEqual(exitCode, 0, `Expected startup failure, output: ${output}`);
  assert.match(output, expectedMessage);
}

async function expectStartupSuccess(env) {
  const child = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !output.includes("Listening on:")) {
      if (child.exitCode !== null) throw new Error(`Server exited unexpectedly: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(output, /Listening on:/);
  } finally {
    child.kill();
  }
}

function request(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ statusCode: res.statusCode, body }));
    });
    req.once("error", reject);
    req.end();
  });
}

async function expectIapAllowlist(env) {
  const child = spawn(process.execPath, ["server/grafana-dashboard-builder.js"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !output.includes("Listening on:")) {
      if (child.exitCode !== null) throw new Error(`IAP test server exited unexpectedly: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(output, /Listening on:/);
    const allowed = await request(Number(env.PORT), "/api/runtime-status", {
      "X-Goog-Authenticated-User-Email": "accounts.google.com:operator@example.com"
    });
    const denied = await request(Number(env.PORT), "/api/runtime-status", {
      "X-Goog-Authenticated-User-Email": "accounts.google.com:intruder@outside.invalid"
    });
    assert.strictEqual(allowed.statusCode, 200);
    assert.strictEqual(denied.statusCode, 401);
  } finally {
    child.kill();
  }
}

async function main() {
  let port = await freePort();
  await expectStartupFailure({ ...baseEnvironment(port), APP_AUTH_MODE: "none" }, /APP_AUTH_MODE=none is not allowed on Cloud Run/);

  port = await freePort();
  await expectStartupFailure({ ...baseEnvironment(port), APP_AUTH_MODE: "access-code" }, /APP_ACCESS_TOKEN is required/);

  port = await freePort();
  await expectStartupFailure({
    ...baseEnvironment(port),
    APP_AUTH_MODE: "google-oidc",
    GOOGLE_OIDC_CLIENT_ID: "test-client.apps.googleusercontent.com"
  }, /GOOGLE_OIDC_ALLOWED_EMAILS or GOOGLE_OIDC_ALLOWED_DOMAINS is required/);

  port = await freePort();
  await expectStartupFailure({
    ...baseEnvironment(port),
    APP_AUTH_MODE: "google-oidc",
    GOOGLE_OIDC_ALLOWED_DOMAINS: "example.com"
  }, /GOOGLE_OIDC_CLIENT_ID is required/);

  port = await freePort();
  await expectStartupFailure({ ...baseEnvironment(port), APP_AUTH_MODE: "iap" }, /GOOGLE_OIDC_ALLOWED_EMAILS or GOOGLE_OIDC_ALLOWED_DOMAINS is required/);

  port = await freePort();
  await expectStartupFailure({ ...baseEnvironment(port), APP_AUTH_MODE: "unexpected" }, /Unsupported APP_AUTH_MODE/);

  port = await freePort();
  await expectStartupSuccess({
    ...baseEnvironment(port),
    APP_AUTH_MODE: "google-oidc",
    GOOGLE_OIDC_CLIENT_ID: "test-client.apps.googleusercontent.com",
    GOOGLE_OIDC_ALLOWED_DOMAINS: "example.com"
  });

  port = await freePort();
  await expectIapAllowlist({
    ...baseEnvironment(port),
    APP_AUTH_MODE: "iap",
    GOOGLE_OIDC_ALLOWED_DOMAINS: "example.com"
  });

  console.log("OK authentication configuration fails closed.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
