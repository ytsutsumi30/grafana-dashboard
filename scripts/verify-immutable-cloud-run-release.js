const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const deployScript = path.join(repoRoot, "scripts", "deploy-cloud-run.ps1");
const source = fs.readFileSync(deployScript, "utf8");

function findPowerShell() {
  for (const command of ["pwsh", "powershell"]) {
    const result = spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], {
      encoding: "utf8"
    });
    if (!result.error && result.status === 0) return command;
  }
  return "";
}

function invokeDryRun(powerShell, promote, releaseId = "r20260718-abc123", initialCreate = false) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gcloud-"));
  const fakeName = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
  const fakePath = path.join(fakeBin, fakeName);
  fs.writeFileSync(fakePath, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n");
  if (process.platform !== "win32") fs.chmodSync(fakePath, 0o755);
  const args = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", deployScript,
    "-ProjectId", "immutable-release-test",
    "-ServiceName", "grafana-test",
    "-ServiceAccount", "grafana-dashboard-builder-run@immutable-release-test.iam.gserviceaccount.com",
    "-AppAuthMode", "access-code",
    "-AppAccessTokenSecret", "test-access-code",
    "-ReleaseId", releaseId,
    "-DryRun"
  ];
  if (promote) {
    args.push("-ExpectedImageDigest", `sha256:${"a".repeat(64)}`, "-Promote");
  }
  if (initialCreate) args.push("-InitialCreate");
  const result = spawnSync(powerShell, args, {
    cwd: repoRoot,
    env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}` },
    encoding: "utf8"
  });
  fs.rmSync(fakeBin, { recursive: true, force: true });
  return result;
}

function dryRun(powerShell, promote) {
  const result = invokeDryRun(powerShell, promote);
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

assert.doesNotMatch(source, /"--source"/);
assert.match(source, /gcloud builds submit/);
assert.match(source, /image_summary\.digest/);
assert.match(source, /"--no-traffic"/);
assert.match(source, /revision\.status\.conditions/);
assert.match(source, /deployedImage\.EndsWith/);
assert.match(source, /if \(\$Promote\)/);
assert.match(source, /ExpectedImageDigest/);
assert.match(source, /candidateTraffic\.revisionName/);
assert.doesNotMatch(source, /ReleaseId\.ToLowerInvariant/);
assert.doesNotMatch(source, /releaseSuffix\.Substring/);

const powerShell = findPowerShell();
if (powerShell) {
  const candidateOnly = dryRun(powerShell, false);
  assert.match(candidateOnly, /gcloud builds submit \. --tag asia-northeast1-docker\.pkg\.dev\/immutable-release-test\/grafana-apps\/grafana-test:r20260718-abc123/);
  assert.match(candidateOnly, /sha256:<resolved-digest>/);
  assert.match(candidateOnly, /--no-traffic/);
  assert.match(candidateOnly, /--revision-suffix r20260718-abc123/);
  assert.match(candidateOnly, /Promotion skipped/);
  assert.doesNotMatch(candidateOnly, /gcloud run services update-traffic/);
  assert.doesNotMatch(candidateOnly, /--source/);

  const initialCreate = invokeDryRun(powerShell, false, "r20260718-first01", true);
  assert.strictEqual(initialCreate.status, 0, initialCreate.stderr || initialCreate.stdout);
  assert.doesNotMatch(initialCreate.stdout, /--no-traffic/);
  assert.match(initialCreate.stdout, /receives production traffic immediately/);

  const promoted = dryRun(powerShell, true);
  assert.match(promoted, /gcloud run services update-traffic grafana-test --to-revisions grafana-test-r20260718-abc123=100/);
  assert.match(promoted, new RegExp(`Verify existing revision Ready=True, image digest sha256:${"a".repeat(64)}`));
  assert.doesNotMatch(promoted, /gcloud builds submit/);
  assert.doesNotMatch(promoted, /gcloud run deploy/);

  const normalizedCollision = invokeDryRun(powerShell, false, "R20260718_ABC123");
  assert.notStrictEqual(normalizedCollision.status, 0, "Lossy ReleaseId normalization must be rejected.");
  const truncatedCollision = invokeDryRun(powerShell, false, `release-${"x".repeat(50)}`);
  assert.notStrictEqual(truncatedCollision.status, 0, "Overlong ReleaseId truncation must be rejected.");
  const initialPromotion = invokeDryRun(powerShell, true, "r20260718-first02", true);
  assert.notStrictEqual(initialPromotion.status, 0, "InitialCreate must not be combined with Promote.");
}

console.log("OK Cloud Run releases use verified immutable image digests and explicit promotion.");
