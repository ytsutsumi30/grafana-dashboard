# Codex + Grafana REST API dashboard automation for Windows WSL2

この記事の内容は Codex でも実現できます。要点は Claude Code 固有機能ではなく、AI エージェントが `curl` で Grafana HTTP API を呼び、JSON でダッシュボードを投入することです。

## 関連ドキュメント

- [Grafana Cloud 製造業向けダッシュボード作成支援ツール 仕様書](docs/dashboard-builder-specification.md)
- [営業担当者向け Grafana Cloud ダッシュボード提案ツール 利用ガイド](docs/sales-user-guide.md)
- [Android Vibration Sensor Demo MVP](docs/android-vibration-demo-mvp.md)
- [出荷検品アプリ監視ダッシュボード デモガイド](docs/shipping-inspection-demo-guide.md)
- [出荷検品アプリ監視API 契約書](docs/shipping-inspection-api-contract.md)
- [Project Skill Application Plan](docs/skill-application-plan.md)

対象記事:
https://blog.elcamy.com/articles/0f371c89

## 何を再現するか

- Grafana を WSL2 上の Docker で起動
- Service Account と Token を REST API で作成
- Grafana 組み込みの TestData datasource を REST API で作成
- IoT センサー監視風のダッシュボードを REST API で一括作成

作成されるパネル:

- Engine Temperature: 時系列、60C/80C 閾値
- Fuel Pressure: 時系列、メイン/サブライン
- Current Status: RPM ゲージ
- Atmospheric Pressure: Stat
- Sensor Alert History: Table

## 前提条件

Windows 側:

- WSL2 が有効
- Docker Desktop がインストール済み
- Docker Desktop の Settings > Resources > WSL Integration で利用するディストリビューションを有効化

WSL2 側:

```bash
sudo apt update
sudo apt install -y curl jq
docker version
docker compose version
```

`docker version` が失敗する場合は Docker Desktop を起動し、WSL Integration を確認してください。

## Docker が WSL2 から見えない場合

WSL2 で以下のエラーが出る場合:

```text
The command 'docker' could not be found in this WSL 2 distro.
We recommend to activate the WSL integration in Docker Desktop settings.
```

Windows の PowerShell で、利用中の WSL ディストリビューション名とバージョンを確認します。

```powershell
wsl.exe -l -v
```

`VERSION` が `1` の場合は WSL2 に変換します。`Ubuntu` は実際のディストリビューション名に置き換えてください。

```powershell
wsl.exe --set-version Ubuntu 2
wsl.exe --set-default-version 2
```

次に Docker Desktop を起動して、以下を設定します。

1. Docker Desktop 画面右上の歯車アイコンをクリックして Settings を開く
2. 左メニューの General を開く
3. `Use the WSL 2 based engine (Windows Home can only run the WSL 2 backend)` が有効になっていることを確認する
   - 添付画面ではこの項目はチェック済みです
4. 左メニューの Resources を開く
5. Resources 配下の WSL integration を開く
6. `Enable integration with my default WSL distro` を有効化する
   - 添付画面ではこの項目はチェック済みです
7. `Enable integration with additional distros:` の一覧で、実際に使う distro のトグルを有効化する
   - 添付画面では `Ubuntu-22.04` と `Ubuntu-24.04` が表示されていますが、どちらもオフです
   - 今回コマンドを実行している WSL が `Ubuntu-24.04` なら `Ubuntu-24.04` をオンにします
   - `Ubuntu-22.04` 側で作業しているなら `Ubuntu-22.04` をオンにします
8. distro が一覧に出ない場合は `Refetch distros` をクリックする
9. 変更後に `Apply & restart` が表示された場合はクリックする

Docker Desktop 公式ドキュメントでも、WSL2 distro から `docker` コマンドを直接使うには WSL Integration を有効にする必要があると説明されています。

反映後、PowerShell で WSL を再起動します。

```powershell
wsl.exe --shutdown
```

その後 WSL2 を開き直して確認します。

```bash
which docker
docker version
docker compose version
```

もし Docker Desktop の Settings > Resources に WSL Integration が出てこない場合は、Docker Desktop が Windows containers mode になっている可能性があります。タスクバーの Docker メニューから `Switch to Linux containers` を選んでから再確認してください。

## 実行手順

WSL2 のシェルで、このディレクトリへ移動します。Windows の OneDrive 配下にある場合は、通常は `/mnt/c/Users/...` から参照できます。

```bash
cd /mnt/c/Users/tsuts/OneDrive/ドキュメント/Grafana
```

Grafana を起動してダッシュボードを作成します。

```bash
chmod +x scripts/setup-grafana-wsl2.sh
./scripts/setup-grafana-wsl2.sh
```

完了後、ブラウザで以下を開きます。

http://localhost:3000/d/ship-sensor-demo/ship-sensor-dashboard-demo

初期ログイン:

- user: `admin`
- password: `admin`

## インフラ監視ダッシュボードを作成する

添付画像のようなダークテーマの監視ダッシュボードを作成する場合は、以下を実行します。

```bash
chmod +x scripts/setup-infrastructure-dashboard.sh
./scripts/setup-infrastructure-dashboard.sh
```

完了後、ブラウザで以下を開きます。

http://localhost:3030/d/infrastructure-overview-demo/infrastructure-overview-demo

作成されるパネル:

- CPU Usage
- Memory Usage
- Network Throughput
- Disk Usage
- Service Health
- Requests Per Second
- Response Latency
- Error Rate
- Database Connections
- Queue Depth
- Top Alerts

## プレス機保全ダッシュボードを作成する

プレス機のリアルタイム監視を想定した保全用ダッシュボードを作成する場合は、以下を実行します。データソースが未整備の段階では Grafana の TestData datasource を使います。

```bash
chmod +x scripts/setup-press-maintenance-dashboard.sh
./scripts/setup-press-maintenance-dashboard.sh
```

完了後、ブラウザで以下を開きます。

http://localhost:3031/d/press-maintenance-demo/press-machine-maintenance-demo

作成されるパネル:

- Cycle Time: 時系列、10-15 s
- Maximum Press Pressure: 時系列、90-110 t
- Die Temperature: 時系列、10-100 C
- Ambient Temperature: Stat、最新値のみ、10-40 C
- Ambient Humidity: Stat、最新値のみ、10-70%
- Vibration Acceleration: 時系列、0.01-0.1 m/s2
- Motor Current: 時系列、30-80 A
- Noise Level: 時系列、60-80 dB

## 電力監視IoTダッシュボードを作成する

電力監視IoTデバイスを想定したダッシュボードを作成する場合は、以下を実行します。データソースが未整備の段階では Grafana の TestData datasource を使います。

```bash
chmod +x scripts/setup-power-monitoring-dashboard.sh
./scripts/setup-power-monitoring-dashboard.sh
```

完了後、ブラウザで以下を開きます。

http://localhost:3031/d/power-monitoring-demo/power-monitoring-iot-demo

作成されるパネル:

- Current Power Usage: Stat、50-500 kW
- Solar / Generated Power: Gauge、0-120 kW
- CO2 Emissions: Stat、100-1200 kg-CO2/day
- Daily Power Trend: 電力使用量、発電量、CO2排出量の日別推移
- Power Distribution by Category: 設備カテゴリ別の電力使用量ドーナツ
- Device Communication Status: IoTデバイス通信状態テーブル

## Grafana Cloud に電力監視IoTダッシュボードを作成する

Grafana Cloud 上に同じダッシュボードを作成する場合は、ローカルの Docker / WSL2 は使わず、Grafana Cloud の URL と Service Account Token を環境変数で渡します。

PowerShell から WSL2 の Bash スクリプトを実行する場合:

```powershell
$env:GRAFANA_URL="https://ytsutsumi30.grafana.net"
$env:GRAFANA_CLOUD_TOKEN="<Service Account Token>"
wsl bash scripts/setup-power-monitoring-dashboard-cloud.sh
```

WSL2 / Bash から直接実行する場合:

```bash
export GRAFANA_URL="https://ytsutsumi30.grafana.net"
export GRAFANA_CLOUD_TOKEN="<Service Account Token>"
chmod +x scripts/setup-power-monitoring-dashboard-cloud.sh
./scripts/setup-power-monitoring-dashboard-cloud.sh
```

スクリプトは以下を実行します。

- `/api/health` で Grafana Cloud への接続を確認
- `uid=testdata` の TestData datasource がなければ作成
- `dashboards/power-monitoring-dashboard.json` を `/api/dashboards/db` に `overwrite: true` で投入
- `/api/dashboards/uid/power-monitoring-demo` で作成結果を確認

完了後のURL:

https://ytsutsumi30.grafana.net/d/power-monitoring-demo/power-monitoring-iot-demo

## Grafana MCP を使う場合

このプロジェクトには Grafana MCP 用の Codex 設定を `.codex/config.toml` に追加しています。Grafana Cloud URL は `https://ytsutsumi30.grafana.net` を使い、Service Account Token はリポジトリに保存せず `GRAFANA_SERVICE_ACCOUNT_TOKEN` 環境変数から読み込みます。

Windows のユーザー環境変数に token を設定する場合:

```powershell
[Environment]::SetEnvironmentVariable("GRAFANA_SERVICE_ACCOUNT_TOKEN", "<Service Account Token>", "User")
```

設定後、Codex を再起動するか、このプロジェクトで新しいCodexスレッドを開いてください。MCPが読み込まれると、CodexからGrafana Cloudのダッシュボード検索、取得、作成、更新をMCPツール経由で実行できます。

この構成で有効化しているGrafana MCPツール範囲:

- `search`
- `dashboard`
- `datasource`
- `folder`
- `api`

`api` は TestData datasource の作成など、標準の dashboard ツールだけでは足りない操作に備えて有効化しています。Codex側の承認モードは `prompt` にしているため、Grafana Cloudへの書き込み操作は実行前に確認されます。

## 営業担当者向け Grafana Cloud ダッシュボード提案UI

訪問先の製造業種を入力し、IoTデバイス監視や製造ライン監視のパネル案を作成・編集して、Grafana Cloud に TestData datasource のデモダッシュボードを作成するローカルUIを追加しています。

起動前に、Windows のユーザー環境変数に Grafana Cloud の Service Account Token を設定します。

```powershell
[Environment]::SetEnvironmentVariable("GRAFANA_SERVICE_ACCOUNT_TOKEN", "<Service Account Token>", "User")
```

現在の PowerShell セッションだけで実行する場合:

```powershell
$env:GRAFANA_SERVICE_ACCOUNT_TOKEN="<Service Account Token>"
$env:GRAFANA_URL="https://ytsutsumi30.grafana.net"
node server/grafana-dashboard-builder.js
```

ユーザー環境変数を設定済みで、新しい PowerShell を開いた場合:

```powershell
$env:GRAFANA_URL="https://ytsutsumi30.grafana.net"
node server/grafana-dashboard-builder.js
```

起動後、ブラウザで以下を開きます。

http://localhost:4173/

別PCから同じLAN内でアクセスする場合は、起動PCのIPアドレスを確認して、そのIPで開きます。

```powershell
ipconfig
```

例:

```text
http://192.168.1.50:4173/
```

明示的にLAN向けに待ち受ける場合:

```powershell
$env:HOST="0.0.0.0"
$env:PORT="4173"
$env:GRAFANA_URL="https://ytsutsumi30.grafana.net"
node server/grafana-dashboard-builder.js
```

Windows ファイアウォールで接続できない場合は、管理者 PowerShell で 4173 番ポートを許可します。

```powershell
New-NetFirewallRule `
  -DisplayName "Grafana Dashboard Builder 4173" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 4173
```

このUIは Grafana Cloud のダッシュボードを作成できるため、社内LANなど信頼できるネットワーク内だけで使ってください。

UIでは以下ができます。

- 「業種欄向けのダッシュボードを作成してください。」に訪問先業種を入力
- `ダッシュボード種別` で `製造ライン・設備保全` または `IoTデバイス監視` を選択
- `Dashboard folder` でGrafana Cloud上の作成先フォルダを選択
- `パネル案作成` で業種向けパネル案を生成
- パネル名、可視化方法、単位、値範囲、目的を編集
- Warning / Critical 閾値をパネルごとに編集
- 作成前に生成前プレビューでレイアウトを確認
- `提案メモ印刷` からブラウザ印刷/PDF保存向けの提案メモを出力
- `実データソース差し替え` でGrafana Cloudのデータソース一覧とパネル別の差し替え確認表を表示
- `作成履歴` で作成済みURLを再表示。ブラウザにも直近履歴を保存
- パネルの追加・削除
- `既存ダッシュボードを上書きする` にチェックしている場合は同じUIDのダッシュボードを更新
- チェックしていない場合、既存UIDがあれば `sheet-metal-maintenance-demo_1` のような連番UIDで新規作成
- `Grafana Cloud に作成` で `testdata` datasource を使うダッシュボードを作成

パネル案作成はハイブリッド方式です。

- 既知業種はコード内の安定したテンプレートを使用
- 未知業種は標準で Vertex AI Gemini でパネル案を生成
- AI生成結果はサーバー側で検証・正規化し、UIで編集可能なパネル案として表示
- 製造ライン・設備保全では、業種別センサーに加えて OEE、稼働率、計画外停止、アラーム件数、保全アクションキュー、ロス内訳、シフト別生産サマリ、品質不良トレンド、不良理由内訳、MTBF/MTTR、アラート候補を先頭に追加
- Vertex AI または OpenAI API が使えない場合は汎用テンプレートへフォールバック

現在の主な既知業種テンプレート:

- 板金加工業者
- プレス加工業者
- 表面処理業者
- 半導体関連製造業者
- 自動車部品製造業者
- 化学製造業者
- 医薬品製造業者
- 射出成形業者
- 食品加工業者
- 電力監視IoTデバイス
- 物流倉庫IoT

Vertex AI Gemini を使う場合は、Cloud Run のサービスアカウントに `roles/aiplatform.user` を付与し、以下を設定します。

```powershell
$env:AI_PROVIDER="vertex"
$env:VERTEX_AI_PROJECT="<GCP Project ID>"
$env:VERTEX_AI_LOCATION="global"
$env:VERTEX_AI_MODEL="gemini-2.5-flash-lite"
```

ローカルでOpenAI APIを使う場合は、代替として以下も利用できます。

```powershell
$env:AI_PROVIDER="openai"
$env:OPENAI_API_KEY="<OpenAI API Key>"
```

Androidスマホ振動センサーデモでは、直近のセンサー履歴から故障兆候をルール判定し、Vertex AIまたはOpenAIで保全コメントを生成できます。Grafanaの `AI Maintenance Insight` パネルと、ブラウザUIの `AI故障診断デモ` から確認できます。

Android実機がない場合は、ブラウザUIの `デモ波形生成` から `正常` / `注意` / `異常` のセンサーデータをCloud Run上に生成し、Grafana Cloudの波形とAI診断を確認できます。
デモ開始前には `波形をリセット` で過去のセンサーデータを消去できます。
通常の営業デモでは `シナリオ実行` を使うと、リセット、波形生成、AI故障診断までをまとめて実行できます。

また、ブラウザUIの `AIログ解析デモ` では、パネル案作成、Grafana作成、センサー受信、APIエラーなどのアプリ内イベントログをAIで要約し、原因候補と推奨対応を確認できます。

## 出荷検品アプリ監視ダッシュボード

`dashboards/shipping-inspection-minimal-monitoring.json` は、出荷検品アプリ向けの最小監視ダッシュボードです。Grafana CloudのInfinity datasourceから、出荷検品アプリ側の監視APIを読みます。

出荷検品アプリ本体のAPI URLが未確定の場合は、このGrafana Dashboard BuilderのCloud RunにあるPoC用モックAPIを使えます。

デモ時の説明順序は [出荷検品アプリ監視ダッシュボード デモガイド](docs/shipping-inspection-demo-guide.md) を参照してください。

投入例:

```powershell
$env:GRAFANA_URL="https://ytsutsumi30.grafana.net"
$env:GRAFANA_SERVICE_ACCOUNT_TOKEN=[Environment]::GetEnvironmentVariable("GRAFANA_SERVICE_ACCOUNT_TOKEN","User")
$env:SHIPPING_INSPECTION_API_BASE_URL="https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app"
node scripts/setup-shipping-inspection-dashboard.js
```

API契約の検証:

```powershell
$env:SHIPPING_INSPECTION_API_BASE_URL="https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app"
node scripts/validate-shipping-inspection-api.js
```

リポジトリ内のダッシュボードJSON検証:

```powershell
node scripts/validate-repository.js
```

GitHub Actionsでは、Node.js構文チェックとダッシュボードJSON検証をpush / pull request時に実行します。

Dashboard UID:

```text
shipping-inspection-minimal-monitoring
```

主なパネル:

- API / DB Health
- Business KPIs
- Alert Status
- Open Workload
- Operation Events Daily
- Inventory Count Variance
- Operation Insights

PoCモックAPIで作成済みのGrafana Cloud URL:

```text
https://ytsutsumi30.grafana.net/d/shipping-inspection-minimal-monitoring/shipping-inspection-minimal-monitoring
```

例として `板金加工業者` を入力した場合、ダッシュボード名は以下になります。

```text
sheet-metal-maintenance-demo
```

作成後のURL形式:

```text
https://ytsutsumi30.grafana.net/d/<業種slug>-maintenance-demo/<業種slug>-machine-maintenance-demo
```

IoTデバイス監視を選択し、`電力監視IoTデバイス` を入力した場合は、以下のようなパネル案を生成します。

- Daily Power Trend: 日別の電力使用量、発電量、CO2排出量の推移
- Power Distribution by Category: 設備カテゴリ別の電力分布ドーナツ
- Current Power Usage: 現在消費電力 Stat
- Solar / Generated Power: 現在発電量 Gauge
- CO2 Emissions: CO2排出量 Stat
- Device Communication Status: IoTデバイス通信状態 Table

作成後のURL形式:

```text
https://ytsutsumi30.grafana.net/d/<業種slug>-iot-monitoring-demo/<業種slug>-iot-monitoring-demo
```

## Cloud Run にホスティングする

このUIは Cloud Run にデプロイできます。ブラウザには token を出さず、Cloud Run のサーバー側だけが Grafana Cloud API と Vertex AI Gemini を呼びます。

構成:

```text
Browser
  -> Cloud Run: Grafana dashboard proposal UI
  -> Grafana Cloud HTTP API
  -> Vertex AI Gemini（未知業種のパネル案生成時のみ）
```

Cloud Run では以下を Secret Manager 経由で渡してください。

- `GRAFANA_SERVICE_ACCOUNT_TOKEN`
- `APP_ACCESS_TOKEN` 任意。一般公開PoCでUI操作をアクセスコード付きにする場合に使う

Secret Manager に値を登録します。値はコマンド履歴に残さないため、プロンプト入力方式を推奨します。

```powershell
gcloud secrets create grafana-service-account-token --replication-policy="automatic"
$grafanaToken = Read-Host "Grafana service account token" -AsSecureString
$grafanaPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($grafanaToken))
$grafanaPlain | gcloud secrets versions add grafana-service-account-token --data-file=-
```

一般公開PoCでアクセスコードを使う場合:

```powershell
gcloud secrets create grafana-dashboard-builder-access-token --replication-policy="automatic"
$appToken = Read-Host "Dashboard builder access code" -AsSecureString
$appPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($appToken))
$appPlain | gcloud secrets versions add grafana-dashboard-builder-access-token --data-file=-
```

デプロイします。通常は認証ありで運用してください。

```powershell
.\scripts\deploy-cloud-run.ps1 `
  -ProjectId "<GCP Project ID>" `
  -Region "asia-northeast1" `
  -AiProvider "vertex"
```

社内検証などで一時的にURLを知っている人がアクセスできる形にする場合のみ、明示的に公開します。

```powershell
.\scripts\deploy-cloud-run.ps1 `
  -ProjectId "<GCP Project ID>" `
  -Region "asia-northeast1" `
  -AppAccessTokenSecret "grafana-dashboard-builder-access-token" `
  -AllowUnauthenticated
```

Cloud Run のサービスURLが表示されたら、そのURLをブラウザで開きます。

注意:

- `--allow-unauthenticated` で公開すると、URLを知っている人がGrafana Cloudにダッシュボードを作成できます。
- `APP_ACCESS_TOKEN` を設定すると、パネル案作成、フォルダ取得、Grafana作成、AI実行、デモデータ生成には画面のアクセスコード入力が必要になります。
- Grafana Cloudが読み取る公開JSON APIとAndroidセンサー受信APIは、デモ連携を壊さないためアクセスコード対象外です。
- 公開GETのAI診断APIは既定でルールベース判定のみを返します。`ai=true` で生成AIを呼ぶ場合はアクセスコードが必要です。
- `APP_RATE_LIMIT_WINDOW_MS` / `APP_RATE_LIMIT_MAX_REQUESTS` で、AI利用・Grafana作成・デモデータ生成の連打を抑止できます。既定は1分あたり30回です。
- 本番利用では Cloud Run IAM、IAP、または社内認証付きの経路で保護してください。
- Vertex AI Gemini は未知業種のパネル案生成時だけ使います。既知業種はテンプレートを使います。

Cloud Run起動確認:

```powershell
Invoke-RestMethod "https://<Cloud Run URL>/api/ping"
```

設定状態の確認:

```powershell
Invoke-RestMethod "https://<Cloud Run URL>/api/runtime-status"
```

`/api/ping` はGrafana tokenなしで起動状態だけを確認します。`/api/runtime-status` は秘密情報の値を返さず、Grafana token設定有無、AI provider、レート制限、アプリ内イベント数などを返します。

作成履歴をFirestoreに保存する場合は、Firestore APIとdatabaseを用意し、Cloud RunサービスアカウントにFirestore書き込み権限を付与したうえで、デプロイ時に `-EnableFirestoreHistory` を追加します。

## 製造向けデモダッシュボードの作成/更新

Cloud Run上のDashboard Builder APIを使って、製造向けデモダッシュボードをGrafana Cloudへ作成または更新できます。

```powershell
.\scripts\create-manufacturing-demo-dashboard.ps1 `
  -Industry "板金加工業者" `
  -DashboardType manufacturing `
  -Overwrite
```

既定では `sheet-metal-maintenance-demo` を更新し、以下のようなURLを返します。

```text
https://ytsutsumi30.grafana.net/d/sheet-metal-maintenance-demo/sheet-metal-machine-maintenance-demo
```

`-Overwrite` を外すと、既存UIDがある場合は `_1`, `_2` のような連番UIDで新規作成します。アクセスコードは `GRAFANA_DASHBOARD_BUILDER_ACCESS_TOKEN` または Secret Manager の `grafana-dashboard-builder-access-token` から取得します。Secret値は画面やログに出力しません。

作成後の検証:

```powershell
.\scripts\verify-manufacturing-demo-dashboard.ps1
```

この検証では、Grafana Cloud APIから `sheet-metal-maintenance-demo` を取得し、パネル数と先頭の製造共通KPI行を確認します。

## NotebookLM 連携

ドキュメントをNotebookLMへ連携する場合は、NotebookLM CLIの認証後に同期スクリプトを実行します。

```powershell
notebooklm login
.\scripts\sync-notebooklm-sources.ps1
```

既存Notebookへ追加する場合:

```powershell
.\scripts\sync-notebooklm-sources.ps1 -NotebookId "<Notebook ID>"
```

NotebookLM MCP 経由で指定Notebookへ連携する場合:

```powershell
node .\scripts\setup-notebooklm-mcp-auth.js
node .\scripts\sync-notebooklm-mcp-sources.js --notebook-url https://notebooklm.google.com/notebook/e6ec4685-1b9b-47ab-a7fd-d4464e1a2324
```

このスクリプトは NotebookLM MCP のブラウザ起動を `BROWSER_CHANNEL=chromium` に固定します。認証に使うブラウザと同期に使うブラウザを一致させるため、認証後に同期がログイン画面へ戻る場合は `setup-notebooklm-mcp-auth.js` から再ログインしてください。

同期時にログイン画面へ戻る場合は、強制再認証します。

```powershell
node .\scripts\setup-notebooklm-mcp-auth.js --force
```

それでも直らない場合は、NotebookLM MCP の認証状態だけを消して再ログインします。

```powershell
node .\scripts\setup-notebooklm-mcp-auth.js --clean
```

同期前に対象ファイルだけ確認する場合:

```powershell
.\scripts\sync-notebooklm-sources.ps1 -DryRun -ManifestPath "docs\notebooklm-source-manifest.json"
```

連携対象は `README.md`、仕様書、営業担当者向けガイド、製造デモランブック、製造データソース差し替えマッピング、Androidセンサーデモ、出荷検品デモ、Skill適用計画、NotebookLM用索引、NotebookLM MCP連携メモ、NotebookLM MCP認証・同期スクリプトです。Secret値やAPIキーは連携対象に含めないでください。

## 環境変数

必要に応じて実行時に上書きできます。

```bash
GRAFANA_URL=http://localhost:3030 \
GRAFANA_ADMIN_USER=admin \
GRAFANA_ADMIN_PASSWORD=admin \
./scripts/setup-grafana-wsl2.sh
```

## `Route not found` または 3000 番ポート競合の場合

ブラウザで以下が表示される場合:

```json
{"error":"Route not found"}
```

またはスクリプト実行時に以下が出る場合:

```text
Bind for 0.0.0.0:3000 failed: port is already allocated
```

`localhost:3000` は今回起動する Grafana ではなく、既に別のアプリまたは別コンテナに使われています。Grafana を別ポートで起動してください。3001 も Open WebUI などで使われていることがあるため、ここでは `3030` を例にします。

```bash
GRAFANA_PORT=3030 ./scripts/setup-grafana-wsl2.sh
```

完了後は以下を開きます。

http://localhost:3030/d/ship-sensor-demo/ship-sensor-dashboard-demo

ログイン画面に `Open WebUIにサインイン` と表示される場合、それは Grafana ではありません。Open WebUI のログイン画面では `admin` がメールアドレスとして扱われるため `@` がないという警告が出ます。この場合も別ポートで Grafana を起動してください。

どのプロセスが 3000 番を使っているか確認する場合:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

Docker 以外の Windows アプリが使っている可能性もあります。その場合は Windows PowerShell で確認できます。

```powershell
Get-NetTCPConnection -LocalPort 3000 | Select-Object LocalAddress,LocalPort,State,OwningProcess
Get-Process -Id <OwningProcess>
```

## 停止

```bash
docker compose down
```

データも削除して最初からやり直す場合:

```bash
docker compose down -v
```

## Grafana MCP Server から使う場合

Grafana MCP Server の設定画面では、Service Account Token 方式を推奨します。

設定値:

| 項目 | 値 |
| --- | --- |
| Grafana URL | `http://localhost:3030` |
| Service Account Token | Grafana で発行した token |
| Username | 空欄 |
| Password | 空欄 |
| Organization ID | 空欄または `1` |

`GRAFANA_PORT=3030` 以外で起動した場合は、Grafana URL のポート番号を実際の値に合わせてください。

Service Account Token は後から再表示できないため、新しく発行します。

Grafana UI で発行する場合:

1. `http://localhost:3030` を開く
2. `admin` / `admin` でログインする
3. 左メニューから Administration または管理メニューを開く
4. Users and access > Service accounts を開く
5. `codex-grafana` があれば開く。なければ role を `Admin` にして作成する
6. Add service account token をクリックする
7. token 名を入力して作成する
8. 表示された token を Grafana MCP Server の `Service Account Token` に貼り付ける

curl で発行する場合:

```bash
SA_ID=$(
  curl -fsS -u admin:admin \
    "http://localhost:3030/api/serviceaccounts/search?query=codex-grafana" \
  | jq -r '.serviceAccounts[] | select(.name == "codex-grafana") | .id' \
  | head -n 1
)

TOKEN=$(
  curl -fsS -u admin:admin \
    -H "Content-Type: application/json" \
    -d '{"name":"mcp-token"}' \
    "http://localhost:3030/api/serviceaccounts/$SA_ID/tokens" \
  | jq -r '.key'
)
echo "$TOKEN"
```

service account id が取れているか確認する場合:

```bash
curl -fsS -u admin:admin \
  "http://localhost:3030/api/serviceaccounts/search?query=codex-grafana" \
| jq '.serviceAccounts[] | {id, name, role}'
```

MCP 設定後の確認:

```bash
curl -fsS \
  -H "Authorization: Bearer <Service Account Token>" \
  http://localhost:3030/api/user \
| jq .
```

ダッシュボードが見えることも確認できます。

```bash
curl -fsS \
  -H "Authorization: Bearer <Service Account Token>" \
  http://localhost:3030/api/dashboards/uid/ship-sensor-demo \
| jq '.dashboard.title'
```

`"Ship Sensor Dashboard - Demo"` と表示されれば、token と URL は正しく設定できています。

`curl: (22) The requested URL returned error: 401` が出る場合:

- `<Service Account Token>` を文字通り入力していないか確認する
- `Bearer` の後ろに、`glsa_...` で始まる実際の token を入れる
- token の前後に `<` `>` は付けない
- token は発行時に一度だけ表示されるため、分からなくなった場合は新しく発行する

デモ環境で管理者パスワードを `admin` に戻す場合:

```bash
docker exec codex-grafana grafana cli admin reset-admin-password admin
```

その後、Service Account Token を再発行します。

## 実務での差し替えポイント

デモでは TestData を使っています。本番では `scripts/setup-grafana-wsl2.sh` の datasource 作成部分を PostgreSQL、InfluxDB、Prometheus などに差し替え、`dashboards/ship-sensor-dashboard.json` の各 panel query を実データ向けに変更します。

Grafana の公式ドキュメントでも、HTTP API は Basic 認証または Service Account Token で認証でき、`POST /api/dashboards/db` で dashboard の作成・更新ができます。
