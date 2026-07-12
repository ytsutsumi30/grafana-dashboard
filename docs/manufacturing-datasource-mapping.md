# Manufacturing Dashboard Datasource Mapping

This document explains how to replace the Grafana `testdata` datasource in the manufacturing demo with real customer data.

## Scope

- Dashboard UID: `sheet-metal-maintenance-demo`
- Demo datasource: `testdata`
- Target use: production manufacturing monitoring, maintenance, quality, and operations review
- This is a mapping guide, not an automatic query converter.

## Recommended Production Data Model

Use a consistent metric table or time-series measurement shape where possible.

### Time-Series Metrics

Recommended fields:

| Field | Description |
| --- | --- |
| `time` | Timestamp in UTC or customer local timezone |
| `site_id` | Plant or site identifier |
| `line_id` | Production line identifier |
| `asset_id` | Machine or equipment identifier |
| `metric` | Metric name |
| `value` | Numeric value |
| `unit` | Unit string |
| `status` | Optional status such as `ONLINE`, `WARN`, `CRITICAL` |

### Event And Action Tables

Recommended fields:

| Field | Description |
| --- | --- |
| `event_time` | Event timestamp |
| `asset_id` | Equipment identifier |
| `event_type` | Alarm, downtime, defect, action, maintenance |
| `severity` | INFO, WARN, CRITICAL |
| `reason` | Reason or category |
| `owner` | Responsible team or person |
| `message` | Human-readable detail |

## Panel Mapping

| Panel | Production metric or table | Typical unit | Validation point |
| --- | --- | --- | --- |
| `Overall Equipment Effectiveness` | OEE metric by line or plant | percent | Value is 0-100 and matches production report |
| `Availability / Uptime` | Availability or uptime metric by line | percent | Drops during planned or unplanned stops |
| `Unplanned Downtime` | Downtime event aggregation by shift | minutes | Sum matches downtime log |
| `Active Alarm Count` | Open alarm count | count | Count matches active alarm system |
| `Maintenance Action Queue` | Maintenance work/action queue | table | Priority, owner, due date are present |
| `Production Loss Breakdown` | Loss category aggregation | percent | Categories sum to near 100 percent |
| `Shift Production Summary` | Shift production result table | units, percent | Planned/actual/reject/downtime match MES report |
| `Quality Defect Trend` | Defect rate by time window | percent | Rate equals rejects divided by production count |
| `Top Defect Reasons` | Defect reason aggregation | count | Top reasons match quality inspection data |
| `MTBF / MTTR Trend` | Maintenance KPI by asset or line | hours, minutes | Values match maintenance KPI report |
| `Alert Rule Candidates` | Static rule candidate table or config table | table | Conditions are agreed with operations team |
| `Cycle Time` | Cycle time by equipment | seconds | Median and max match PLC/MES values |
| `Press Brake Load` | Press brake load or pressure | percent or ton | Value changes during press cycle |
| `Laser Cutter Power` | Laser power output | kW | Value changes during cutting operation |
| `Compressor Pressure` | Air pressure | bar | Drops during leak or high demand |
| `Ambient Temperature` | Ambient temperature sensor | celsius | Latest value matches local sensor |
| `Ambient Humidity` | Ambient humidity sensor | percent | Latest value matches local sensor |
| `Motor Current` | Motor current | amp | Increases under load |
| `Vibration Acceleration` | Vibration acceleration | m/s2 | Spikes during abnormal vibration |

## Query Examples

### Prometheus

```promql
avg_over_time(oee_percent{line_id="$line"}[5m])
sum by (reason) (increase(defect_count_total{line_id="$line"}[1h]))
avg_over_time(vibration_acceleration_ms2{asset_id="$asset"}[5m])
```

### InfluxDB Flux

```flux
from(bucket: "factory")
  |> range(start: v.timeRangeStart, stop: v.timeRangeStop)
  |> filter(fn: (r) => r.line_id == "sheet-metal-line-1")
  |> filter(fn: (r) => r._measurement == "cycle_time")
```

### PostgreSQL

```sql
select
  time_bucket('5 minutes', time) as time,
  avg(value) as value
from manufacturing_metrics
where metric = 'cycle_time_seconds'
  and line_id = 'sheet-metal-line-1'
  and $__timeFilter(time)
group by 1
order by 1;
```

### BigQuery

```sql
select
  timestamp_trunc(time, minute) as time,
  avg(value) as value
from `project.dataset.manufacturing_metrics`
where metric = 'oee_percent'
  and line_id = 'sheet-metal-line-1'
  and time between timestamp_millis(${__from}) and timestamp_millis(${__to})
group by time
order by time;
```

## Replacement Steps

1. Add the production datasource in Grafana Cloud.
2. Open the dashboard builder UI.
3. Generate or load the manufacturing panel proposal.
4. Use `実データソース差し替え` to list datasources and produce a panel replacement plan.
5. For each panel, replace `testdata` with the production datasource.
6. Replace TestData query settings with the customer query.
7. Validate units, thresholds, and time range.
8. Confirm with maintenance, production, and quality owners.
9. Only after validation, create Grafana Alerting rules from `Alert Rule Candidates`.

## Production Readiness Checklist

- Datasource permissions are scoped to the customer workspace.
- Dashboard folder permissions are configured.
- Query performance is acceptable for the default refresh interval.
- Metric names and units are documented.
- Thresholds are approved by the customer.
- Alert contacts and escalation routes are approved.
- Secrets are stored in Grafana datasource settings or cloud secret stores, not in dashboard JSON.

## Limits

- TestData values in the demo are illustrative.
- Query examples must be adapted to the customer's schema.
- Alert candidates are recommendations and should not be enabled without operational review.
