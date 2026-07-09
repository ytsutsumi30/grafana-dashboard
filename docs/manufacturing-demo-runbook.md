# Manufacturing Grafana Demo Runbook

This runbook is the NotebookLM-friendly operating guide for the current manufacturing Grafana Cloud demo.

## Demo Target

- Audience: manufacturing executives, production managers, maintenance leaders, and quality engineers
- Scenario: sheet metal manufacturer maintenance and production monitoring
- Grafana Cloud dashboard: `sheet-metal-maintenance-demo`
- URL: `https://ytsutsumi30.grafana.net/d/sheet-metal-maintenance-demo/sheet-metal-machine-maintenance-demo`
- Datasource: Grafana `testdata`
- Data status: mock demo data, not production telemetry

## Pre-Demo Checklist

1. Confirm Cloud Run is healthy.

```powershell
Invoke-RestMethod "https://grafana-dashboard-builder-577010681495.asia-northeast1.run.app/api/ping"
```

2. Refresh the manufacturing demo dashboard.

```powershell
.\scripts\create-manufacturing-demo-dashboard.ps1 `
  -Industry "板金加工業者" `
  -DashboardType manufacturing `
  -Overwrite
```

3. Verify Grafana Cloud dashboard structure.

```powershell
.\scripts\verify-manufacturing-demo-dashboard.ps1
```

Expected result:

- `ok`: `true`
- `panelCount`: `19` or higher
- `Alert Rule Candidates`: found
- `MTBF / MTTR Trend`: found
- `Quality Defect Trend`: found
- `Top Defect Reasons`: found

## Demo Flow

### 1. Start With Executive Condition

Open with the top KPI row:

- `Overall Equipment Effectiveness`: overall production condition
- `Availability / Uptime`: whether equipment is currently available
- `Unplanned Downtime`: recent lost time
- `Active Alarm Count`: unresolved issues

Talk track:

```text
最初にライン全体の健全性を見ます。OEE、稼働率、停止時間、アラーム件数を上段に置くことで、
現場担当だけでなく工場長や管理者も一目で状態を判断できます。
```

### 2. Move To Maintenance Action

Use:

- `Maintenance Action Queue`
- `MTBF / MTTR Trend`
- `Alert Rule Candidates`

Talk track:

```text
次に、どの設備を誰がいつ確認するかをアクションキューで整理します。
MTBF/MTTRを見ることで、保全活動が故障間隔を伸ばし、復旧時間を短くしているかを説明できます。
最後にAlert Rule Candidatesを見せることで、本番化時にどの条件をGrafana Alertingへ移すかを具体化できます。
```

### 3. Explain Production Loss

Use:

- `Production Loss Breakdown`
- `Shift Production Summary`

Talk track:

```text
停止、段取り、軽微停止、速度低下、品質ロスのどこに改善余地があるかを見ます。
シフト別サマリでは、設備状態と生産計画達成率をつなげて説明できます。
```

### 4. Explain Quality Impact

Use:

- `Quality Defect Trend`
- `Top Defect Reasons`

Talk track:

```text
不良率の時間変化と不良理由を合わせて見ることで、設備条件、シフト、材料、作業条件との関係を確認できます。
品質担当者には、どの不良理由から改善テーマにするかを説明できます。
```

### 5. Drill Down Into Equipment Signals

Use:

- `Cycle Time`
- `Press Brake Load`
- `Laser Cutter Power`
- `Compressor Pressure`
- `Ambient Temperature`
- `Ambient Humidity`
- `Motor Current`
- `Vibration Acceleration`

Talk track:

```text
最後に、原因候補を設備信号へ掘り下げます。
サイクルタイム、負荷、エア圧、温湿度、電流、振動を見ることで、異常兆候を設備単位で説明できます。
```

## Customer Questions And Answers

### Can this use real data?

Yes. The current dashboard uses Grafana TestData for the demo. For production, replace `testdata` panels with the customer's datasource and map each panel to the real metric query.

### Can this support other manufacturing industries?

Yes. The dashboard builder has templates for sheet metal, press, surface treatment, semiconductor, automotive parts, chemical, pharmaceutical, injection molding, food processing, power IoT, and warehouse IoT. Unknown industries can use Vertex AI generation with schema validation.

### Is this only for maintenance?

No. The current design covers maintenance, production performance, quality defects, and management KPIs. It can be shown to maintenance leaders, production managers, quality engineers, and plant managers.

### What should be changed for a real customer?

- Replace TestData with real datasource queries.
- Confirm units and thresholds with the customer.
- Adjust panel names to customer equipment names.
- Add alert rules for critical metrics.
- Add folder and permissions for the customer organization.

## Limits

- This is a Grafana Cloud demo.
- All values are mock values.
- Cloud Run API and Grafana Cloud tokens must remain server-side.
- Do not paste secrets into NotebookLM, chat, documents, or screenshots.
