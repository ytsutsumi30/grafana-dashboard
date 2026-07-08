# 出荷検品アプリ監視ダッシュボード デモガイド

## 目的

出荷検品アプリのPoC監視画面として、業務KPI、滞留、日次イベント、棚卸差異、アラート風ステータス、運用インサイトをGrafana Cloudで確認する。

このデモは、出荷・検品・棚卸の現場向けに「業務アプリの稼働状態と業務滞留を一画面で見える化できる」ことを説明するためのもの。

## URL

Grafana Cloud:

```text
https://ytsutsumi30.grafana.net/d/shipping-inspection-minimal-monitoring/shipping-inspection-minimal-monitoring
```

PoC API:

```text
https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app
```

## デモの流れ

1. `API / DB Health` を確認する
   - アプリとDBが正常に見える状態を示す
   - 本番ではヘルスチェックAPIやDB疎通結果に差し替える

2. `Business KPIs` を確認する
   - 未出荷、未検品、棚卸差異、本日完了件数をまとめて見る
   - 管理者が毎朝確認する入口画面として説明する

3. `Alert Status` を確認する
   - Shipping backlogやInventory varianceがWARNになっていることを見せる
   - Grafana Alerting本設定の前段として、状態一覧を表示していると説明する

4. `Open Workload` を確認する
   - 出荷、検品、棚卸、返品の滞留量を比較する
   - どの業務領域に作業負荷が偏っているかを把握する

5. `Operation Events Daily` を確認する
   - 日別の出荷完了、検品完了、棚卸差異イベントを確認する
   - 曜日や作業量の偏りを説明する

6. `Inventory Count Variance` を確認する
   - 棚卸差異が残っているカウントを確認する
   - 現場で確認すべき棚番や作業単位に展開できることを説明する

7. `Operation Insights` を確認する
   - 何が問題で、何をすべきかを運用コメントとして表示する
   - 本番ではルール判定や生成AIコメントに差し替え可能

## 話すポイント

- Grafana Cloudは設備監視だけでなく、業務アプリの運用監視にも使える。
- 出荷検品アプリのような現場アプリでは、システム稼働状態と業務滞留を同じ画面で見る価値がある。
- PoCではCloud RunのモックAPIを使っているが、本番では出荷検品アプリ側のAPIに差し替える。
- Alert StatusはGrafana Alertingの代替ではなく、営業デモで状態を分かりやすく見せるための簡易パネル。
- Operation Insightsは、単なる数値ではなく次に取るべき対応を見せるためのパネル。

## 本番APIへの差し替え

本番APIに差し替える場合は、以下の環境変数に出荷検品アプリのAPI URLを設定して再投入する。

```powershell
$env:GRAFANA_URL="https://ytsutsumi30.grafana.net"
$env:GRAFANA_SERVICE_ACCOUNT_TOKEN=[Environment]::GetEnvironmentVariable("GRAFANA_SERVICE_ACCOUNT_TOKEN","User")
$env:SHIPPING_INSPECTION_API_BASE_URL="<出荷検品アプリのAPI URL>"
node scripts/setup-shipping-inspection-dashboard.js
```

本番APIに必要なエンドポイント:

```text
GET /api/monitoring/grafana-cloud/kpis
GET /api/monitoring/grafana-cloud/backlog
GET /api/monitoring/grafana-cloud/events-daily
GET /api/monitoring/grafana-cloud/inventory-count-variance
GET /api/monitoring/grafana-cloud/operation-insights
GET /api/monitoring/grafana-cloud/alert-status
```

## 注意点

- 現在のPoCデータはCloud Run側の固定モックデータ。
- 実際の出荷検品アプリDBやSupabaseには接続していない。
- 本番では認証、CORS、APIレスポンス形式、Grafana Infinity datasourceからの到達性を確認する。
- 本番のAlertingはGrafana Alertingまたはアプリ側通知基盤で別途設計する。
