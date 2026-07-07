# Project Skill Application Plan

This project uses a small set of Codex skills for repeatable Grafana, GCP, Android, and documentation work.

## Skill Locations

Skills are installed under:

```text
C:\Users\tsuts\.codex\skills
```

Project source is managed by GitHub:

```text
https://github.com/ytsutsumi30/grafana-dashboard.git
```

Preferred working folder:

```text
G:\My Drive\AI-Memory\projects\Grafana
```

Legacy folder:

```text
C:\Users\tsuts\OneDrive\Documents\Grafana
```

## Created Skills

### grafana-dashboard-provisioning

Use for:

- Grafana dashboard JSON creation and updates
- Grafana Cloud or OSS dashboard API calls
- Datasource UID checks
- Dashboard folder selection
- Infinity, TestData, and Prometheus query updates
- Dashboard URL verification

Typical validation:

```powershell
node --check server\grafana-dashboard-builder.js
node -e "JSON.parse(require('fs').readFileSync('dashboards/android-vibration-sensor-dashboard.json','utf8'))"
```

### gcp-cloud-run-grafana-deploy

Use for:

- Cloud Run deploys
- Secret Manager integration
- Service account and IAM checks
- Vertex AI settings
- Public URL and health check verification

Typical validation:

```powershell
Invoke-RestMethod "https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app/api/health"
```

### android-sensor-demo

Use for:

- Android vibration demo changes
- Accelerometer, tap shock, battery, and status payloads
- APK debug builds
- Cloud Run receiver tests

Typical validation:

```powershell
$env:ANDROID_HOME="C:\Users\tsuts\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT="C:\Users\tsuts\AppData\Local\Android\Sdk"
C:\Users\tsuts\AndroidStudioProjects\helloworld\gradlew.bat `
  -p "<project-root>\mobile\android-vibration-demo" `
  assembleDebug
```

### supabase-grafana-oss

Use for:

- Grafana OSS on Cloud Run planning
- Supabase Postgres as Grafana metadata DB
- OSS-vs-Cloud feature tradeoffs
- Dockerfile and provisioning design

Initial scope:

- `grafana/grafana` container
- Supabase Postgres
- Cloud Run `max-instances=1`
- Secret Manager for DB/admin passwords

### sales-demo-documentation

Use for:

- Specs
- Sales user guides
- Demo runbooks
- Cost notes
- Customer-facing explanations

Typical validation:

```powershell
rg -n "glsa_|sk-|OPENAI_API_KEY=|GRAFANA_SERVICE_ACCOUNT_TOKEN=" .
git diff --stat
```

## Operating Model

1. Start every implementation task with `git status --short --branch`.
2. Use the specific skill for the task domain.
3. Run the validation listed in the skill.
4. Deploy only after local/API checks pass.
5. Commit and push to GitHub.

## Priority Usage

1. Use `grafana-dashboard-provisioning` for dashboard features.
2. Use `gcp-cloud-run-grafana-deploy` for Cloud Run changes.
3. Use `android-sensor-demo` for mobile demo changes.
4. Use `supabase-grafana-oss` for the OSS Grafana + Supabase plan.
5. Use `sales-demo-documentation` whenever behavior changes require docs.
