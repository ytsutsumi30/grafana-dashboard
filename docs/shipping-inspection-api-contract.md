# 出荷検品アプリ監視API 契約書

## 目的

Grafana Cloudの `shipping-inspection-minimal-monitoring` ダッシュボードが読み込むJSON APIのレスポンス契約を定義する。

本番の出荷検品アプリへ差し替える場合、以下のエンドポイントとフィールド名を維持すると、Grafana dashboard JSONを大きく変更せずに接続できる。

## 共通仕様

- Base URLは `SHIPPING_INSPECTION_API_BASE_URL` で指定する
- 各エンドポイントは `GET` を受け付ける
- レスポンスはJSON配列を返す
- Grafana Infinity datasourceから直接取得できること
- 日時はISO 8601文字列、またはGrafanaがtimestampとして解釈できる文字列にする
- 数値フィールドは文字列ではなくnumberで返す

## 1. KPIs

Endpoint:

```text
GET /api/monitoring/grafana-cloud/kpis
```

Fields:

| field | type | required | example | note |
| --- | --- | --- | --- | --- |
| `metric` | string | yes | `api_db_health` | KPI識別子 |
| `value` | number | yes | `1` | KPI値 |
| `unit` | string | no | `count` | `bool`, `count`, `lines` など |
| `status` | string | yes | `OK` | `OK`, `WARN`, `CRITICAL` |

Example:

```json
[
  { "metric": "api_db_health", "value": 1, "unit": "bool", "status": "OK" },
  { "metric": "open_shipments", "value": 18, "unit": "count", "status": "WARN" }
]
```

## 2. Backlog

Endpoint:

```text
GET /api/monitoring/grafana-cloud/backlog
```

Fields:

| field | type | required | example | note |
| --- | --- | --- | --- | --- |
| `domain` | string | yes | `shipping` | 業務領域 |
| `open_count` | number | yes | `18` | 未完了件数 |
| `open_quantity` | number | yes | `126` | 未完了数量 |

Example:

```json
[
  { "domain": "shipping", "open_count": 18, "open_quantity": 126 },
  { "domain": "inspection", "open_count": 7, "open_quantity": 39 }
]
```

## 3. Events Daily

Endpoint:

```text
GET /api/monitoring/grafana-cloud/events-daily
```

Fields:

| field | type | required | example | note |
| --- | --- | --- | --- | --- |
| `event_date` | timestamp | yes | `2026-07-09` | 日付または日時 |
| `event_domain` | string | yes | `shipping` | 業務領域 |
| `event_type` | string | yes | `completed` | イベント種別 |
| `event_count` | number | yes | `34` | 件数 |

Example:

```json
[
  { "event_date": "2026-07-09", "event_domain": "shipping", "event_type": "completed", "event_count": 34 }
]
```

## 4. Inventory Count Variance

Endpoint:

```text
GET /api/monitoring/grafana-cloud/inventory-count-variance
```

Fields:

| field | type | required | example | note |
| --- | --- | --- | --- | --- |
| `count_no` | string | yes | `CNT-20260709-001` | 棚卸番号 |
| `count_name` | string | yes | `Main stock location` | 棚卸名 |
| `status` | string | yes | `OPEN` | `OPEN`, `REVIEW`, `CLOSED` など |
| `variance_lines` | number | yes | `4` | 差異行数 |
| `variance_quantity` | number | yes | `-12` | 差異数量 |
| `variance_quantity_abs` | number | yes | `12` | 差異数量の絶対値 |
| `last_counted_at` | timestamp | yes | `2026-07-09T10:00:00Z` | 最終棚卸時刻 |

## 5. Operation Insights

Endpoint:

```text
GET /api/monitoring/grafana-cloud/operation-insights
```

Fields:

| field | type | required | example | note |
| --- | --- | --- | --- | --- |
| `area` | string | yes | `Shipping` | 対象領域 |
| `risk` | string | yes | `WARN` | `OK`, `WARN`, `CRITICAL` |
| `score` | number | yes | `68` | 0から100 |
| `summary` | string | yes | `Open shipments are above threshold.` | 状況要約 |
| `likely_cause` | string | yes | `Inspection completion is behind.` | 原因候補 |
| `recommended_action` | string | yes | `Prioritize completed picking shipments.` | 推奨対応 |

## 6. Alert Status

Endpoint:

```text
GET /api/monitoring/grafana-cloud/alert-status
```

Fields:

| field | type | required | example | note |
| --- | --- | --- | --- | --- |
| `area` | string | yes | `Shipping backlog` | 対象領域 |
| `status` | string | yes | `WARN` | `OK`, `WARN`, `CRITICAL` |
| `severity` | number | yes | `2` | 0=OK, 1=INFO, 2=WARN, 3=CRITICAL |
| `message` | string | yes | `Open shipment workload is above threshold.` | 状態メッセージ |
| `owner` | string | no | `Shipping` | 担当部門 |
| `updated_at` | timestamp | yes | `2026-07-09T10:00:00Z` | 更新時刻 |

## 差し替え時の確認

1. 本番APIが上記フィールド名でJSON配列を返す
2. Grafana CloudからBase URLへ到達できる
3. CORSまたは認証方式がInfinity datasourceからのアクセスを妨げない
4. `scripts/validate-shipping-inspection-api.js` でAPI契約を検証する
5. `scripts/setup-shipping-inspection-dashboard.js` で再投入する
6. Grafana Cloudで各パネルがNo dataにならないことを確認する

検証コマンド:

```powershell
$env:SHIPPING_INSPECTION_API_BASE_URL="<出荷検品アプリのAPI URL>"
node scripts/validate-shipping-inspection-api.js
```

## PoCモックAPI

現在のPoCでは以下をBase URLとして利用できる。

```text
https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app
```
