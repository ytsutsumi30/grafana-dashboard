# Manufacturing Dashboard Build Log

This document records the current Grafana Cloud manufacturing dashboard build state for NotebookLM and demo preparation.

## Current Grafana Cloud Dashboard

- Purpose: Manufacturing maintenance and line monitoring demo
- Customer scenario: Sheet metal manufacturer
- Grafana Cloud URL: `https://ytsutsumi30.grafana.net`
- Dashboard UID: `sheet-metal-maintenance-demo`
- Dashboard URL: `https://ytsutsumi30.grafana.net/d/sheet-metal-maintenance-demo/sheet-metal-machine-maintenance-demo`
- Datasource: `testdata`
- Mock data type: Grafana TestData random walk
- Refresh: `5s`
- Time range: `now-6h` to `now`

## Current Panel Structure

The dashboard starts with a manufacturing overview KPI row:

1. `Overall Equipment Effectiveness`
2. `Availability / Uptime`
3. `Unplanned Downtime`
4. `Active Alarm Count`
5. `Maintenance Action Queue`
6. `Production Loss Breakdown`
7. `Shift Production Summary`
8. `Quality Defect Trend`
9. `Top Defect Reasons`

The overview row is followed by industry-specific sheet metal equipment panels:

- `Cycle Time`
- `Press Brake Load`
- `Laser Cutter Power`
- `Compressor Pressure`
- `Ambient Temperature`
- `Ambient Humidity`
- `Motor Current`
- `Vibration Acceleration`

Total expected panel count: `17`.

## Build Command

Use this command to create or update the current demo dashboard through the Cloud Run dashboard builder API:

```powershell
.\scripts\create-manufacturing-demo-dashboard.ps1 `
  -Industry "板金加工業者" `
  -DashboardType manufacturing `
  -Overwrite
```

The script reads the app access code from `GRAFANA_DASHBOARD_BUILDER_ACCESS_TOKEN` or Google Secret Manager.

## Verification Command

Use this command to verify the current Grafana Cloud dashboard:

```powershell
.\scripts\verify-manufacturing-demo-dashboard.ps1
```

Expected verification result:

- `ok`: `true`
- `uid`: `sheet-metal-maintenance-demo`
- `panelCount`: `17` or higher
- `leadingPanels`: `Overall Equipment Effectiveness, Availability / Uptime, Unplanned Downtime, Active Alarm Count`

## Demo Story

Use the overview row first to explain the line-level condition:

- OEE shows whether the line is healthy as a whole.
- Availability shows whether equipment is currently operating.
- Unplanned downtime shows recent loss time.
- Active alarms show unresolved operational issues.
- Maintenance Action Queue translates the dashboard state into concrete next checks.
- Production Loss Breakdown explains which loss category should be attacked first.
- Shift Production Summary connects equipment condition to production plan attainment.
- Quality Defect Trend shows whether quality issues are increasing by time window.
- Top Defect Reasons shows which defect category should be investigated first.

Then drill down into equipment panels:

- Cycle time and press brake load explain process stability.
- Laser cutter power and compressor pressure explain utility and machine conditions.
- Ambient temperature/humidity show environmental context.
- Motor current and vibration show maintenance risk signals.

## Current Limits

- This is a Grafana Cloud demo dashboard, not a production monitoring system.
- Values are TestData mock values.
- Actual customer deployment requires datasource replacement and query mapping.
- The browser UI provides a datasource replacement plan, but production queries must be validated against the real datasource.
- App access code and Grafana tokens must not be pasted into NotebookLM sources.
