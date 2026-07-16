# NotebookLM Source Index

This index summarizes the source documents for the Grafana dashboard builder PoC.

## Project Overview

- `README.md`: setup, local execution, Cloud Run deployment, Secret Manager, cost and operational notes.
- `docs/manufacturing-dashboard-build-log.md`: current Grafana Cloud manufacturing dashboard build state, panel structure, verification command, and demo story.
- `docs/manufacturing-demo-runbook.md`: demo flow, talk track, pre-demo checklist, customer Q&A, and limits for the manufacturing Grafana demo.
- `docs/manufacturing-datasource-mapping.md`: production datasource mapping guide for replacing Grafana TestData with real manufacturing data.
- `docs/notebooklm-source-manifest.json`: machine-readable source list for NotebookLM sync dry runs.
- `docs/notebooklm-mcp-integration.md`: NotebookLM MCP findings, target notebook, sync strategy, and current limitations.
- `docs/ui-change-verification-loop.md`: finite UI improvement loop covering prioritization, doer/verifier separation, desktop/mobile browser checks, console error checks, screenshots, retry limits, and related tests.
- `docs/dashboard-builder-specification.md`: system specification for the sales dashboard builder, API endpoints, security model, Firestore history, Grafana Cloud integration, and AI behavior.
- `docs/sales-user-guide.md`: sales representative guide for creating customer-specific manufacturing and IoT monitoring dashboards.

## Android Sensor Demo

- `docs/android-vibration-demo-mvp.md`: Android vibration sensor app, Cloud Run receiver API, Grafana Cloud dashboard, AI maintenance analysis, and demo commands.

## Shipping Inspection Demo

- `docs/shipping-inspection-api-contract.md`: shipping inspection demo API contract.
- `docs/shipping-inspection-demo-guide.md`: shipping inspection demo operation guide.

## Skills And Development Plan

- `docs/skill-application-plan.md`: Codex skills usage plan for this application and related development workflows.

## Current Operating Assumptions

- Cloud Run service: `grafana-dashboard-builder`
- GCP project: `modern-replica-465803-n8`
- Region: `asia-northeast1`
- Grafana Cloud URL: `https://ytsutsumi30.grafana.net`
- AI provider: Vertex AI Gemini
- App access code is stored in Secret Manager and required for protected UI and AI model operations.
- Firestore is used for dashboard creation history when `FIRESTORE_HISTORY_ENABLED=true`.
- Manufacturing maintenance dashboards include common overview/action panels before industry-specific sensor panels: OEE, uptime, unplanned downtime, active alarms, maintenance action queue, production loss breakdown, shift production summary, quality defect trend, top defect reasons, MTBF/MTTR trend, and alert rule candidates.

## Current Demo Dashboard

- Standard manufacturing demo script: `scripts/create-manufacturing-demo-dashboard.ps1`
- Standard manufacturing verification script: `scripts/verify-manufacturing-demo-dashboard.ps1`
- NotebookLM MCP auth setup script: `scripts/setup-notebooklm-mcp-auth.js`
- NotebookLM MCP source sync script: `scripts/sync-notebooklm-mcp-sources.js`
- UI improvement verification loop script: `scripts/verify-ui-change-loop.js` (evidence is written to the Git-ignored `outputs/ui-verification/` directory)
- Current sheet metal demo UID: `sheet-metal-maintenance-demo`
- Current sheet metal demo URL: `https://ytsutsumi30.grafana.net/d/sheet-metal-maintenance-demo/sheet-metal-machine-maintenance-demo`

## Important Security Notes

- Do not store Grafana service account tokens, OpenAI keys, app access codes, or Google credentials in NotebookLM sources.
- Public Grafana JSON endpoints used by dashboards should default to rule-based responses.
- AI model calls require explicit UI action or `ai=true` with the app access code.
