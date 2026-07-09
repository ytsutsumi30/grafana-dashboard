# Grafana Cloud 製造業向けダッシュボード作成支援ツール 仕様書

## 1. 概要

本ツールは、営業担当者が訪問先顧客の業種や監視対象を入力し、製造ライン・設備保全またはIoTデバイス監視向けのGrafana Cloudダッシュボード案を作成するWebアプリケーションである。

営業現場でのPoC・デモ用途を主目的とし、本番データソースが未整備の段階でもGrafana CloudのTestData datasourceを使って、監視ダッシュボードの見た目と構成を素早く提示できる。

## 2. 目的

- 製造業顧客向けに、業種に応じた監視ダッシュボード案を短時間で作成する
- パネル案を営業担当者が編集し、顧客の業務に合わせたデモを作成する
- Grafana Cloud上にTestData datasourceを使ったデモダッシュボードを作成する
- 既知業種は安定したテンプレート、未知業種はVertex AI Geminiによる生成を使い分ける

## 3. 対象ユーザー

- 製造業向け営業担当者
- プリセールス担当者
- IoTデバイス提案担当者
- 保全・設備監視ソリューションのデモ担当者

## 4. システム構成

```text
Browser
  -> Cloud Run / ローカルNode.jsサーバー
      -> Grafana Cloud HTTP API
      -> Vertex AI Gemini
```

### 4.1 フロントエンド

- ファイル: `public/grafana-sales-dashboard-builder.html`
- 単一HTMLアプリケーション
- 業種入力、ダッシュボード種別選択、パネル案編集、Grafana Cloud作成を提供する

### 4.2 バックエンド

- ファイル: `server/grafana-dashboard-builder.js`
- Node.js標準HTTPサーバー
- 外部npmパッケージには依存しない
- Grafana Cloud APIとVertex AI Geminiをサーバー側から呼び出す

### 4.3 ホスティング

- ローカル実行: `http://localhost:4173/`
- Cloud Run実行: `https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app`
- Cloud RunではSecret Managerから認証情報を注入する

## 5. 環境変数

| 環境変数 | 必須 | 既定値 | 用途 |
| --- | --- | --- | --- |
| `PORT` | 任意 | `4173` | HTTPサーバーのポート |
| `HOST` | 任意 | `0.0.0.0` | HTTPサーバーの待ち受けアドレス |
| `GRAFANA_URL` | 必須 | `https://ytsutsumi30.grafana.net` | Grafana Cloud URL |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | 必須 | なし | Grafana Cloud API呼び出し用トークン |
| `GRAFANA_CLOUD_TOKEN` | 任意 | なし | 代替のGrafana Cloud APIトークン |
| `APP_ACCESS_TOKEN` | 任意 | なし | UI操作APIを保護するアクセスコード |
| `DASHBOARD_BUILDER_ACCESS_TOKEN` | 任意 | なし | `APP_ACCESS_TOKEN` の代替名 |
| `APP_RATE_LIMIT_WINDOW_MS` | 任意 | `60000` | 書き込み・AI系APIのレート制限時間窓 |
| `APP_RATE_LIMIT_MAX_REQUESTS` | 任意 | `30` | 時間窓あたりの最大リクエスト数。`0` 以下で無効 |
| `FIRESTORE_HISTORY_ENABLED` | 任意 | `false` | 作成履歴をFirestoreへ保存するか |
| `FIRESTORE_PROJECT` | 任意 | `VERTEX_AI_PROJECT` | FirestoreのGCP Project ID |
| `FIRESTORE_DATABASE` | 任意 | `(default)` | Firestore database ID |
| `FIRESTORE_HISTORY_COLLECTION` | 任意 | `dashboard_creation_history` | 作成履歴コレクション名 |
| `AI_PROVIDER` | 任意 | `vertex` | `vertex` または `openai` |
| `VERTEX_AI_PROJECT` | Vertex利用時必須 | なし | Vertex AIを呼び出すGCP Project ID |
| `VERTEX_AI_LOCATION` | 任意 | `global` | Vertex AIのロケーション |
| `VERTEX_AI_MODEL` | 任意 | `gemini-2.5-flash-lite` | パネル案生成に使うGeminiモデル |
| `OPENAI_API_KEY` | OpenAI利用時必須 | なし | OpenAI APIを使う場合のAPIキー |
| `OPENAI_MODEL` | 任意 | `gpt-4.1-mini` | OpenAIを使う場合のモデル |
| `AI_ANALYSIS_CACHE_TTL_MS` | 任意 | `60000` | センサー故障診断AIコメントのキャッシュ時間 |
| `APP_LOG_MAX_EVENTS` | 任意 | `500` | アプリ内イベントログの最大保持件数 |

`GRAFANA_SERVICE_ACCOUNT_TOKEN` と `GRAFANA_CLOUD_TOKEN` の両方が設定されている場合、`GRAFANA_SERVICE_ACCOUNT_TOKEN` を優先する。

`APP_ACCESS_TOKEN` が設定されている場合、営業UIからのフォルダ取得、パネル案生成、ダッシュボード作成、AI実行、デモデータ生成には `X-App-Access-Token` ヘッダーが必要になる。

`APP_RATE_LIMIT_WINDOW_MS` と `APP_RATE_LIMIT_MAX_REQUESTS` は、AI利用、Grafana作成、デモデータ生成などの連打を抑止する。PoC向けのCloud Runインスタンス内メモリ制限であり、本番の厳密な制御にはCloud Armor、API Gateway、IAP、または外部ストアを使う。

## 6. 機能仕様

### 6.1 パネル案作成

ユーザーは以下を入力・選択する。

- 業種または監視対象
- ダッシュボード種別
  - 製造ライン・設備保全
  - IoTデバイス監視
- 顧客/案件ラベル 任意。提案メモとブラウザ保存履歴に使用
- 営業担当者 任意。提案メモに使用
- Dashboard folder

パネル案作成時の動作:

1. 入力された業種とダッシュボード種別をサーバーへ送信する
2. 既知業種に該当する場合はテンプレートを返す
3. 未知業種の場合は標準でVertex AI Geminiによりパネル案を生成する
4. 製造ライン・設備保全では、業種別パネルの前に共通KPI行を追加する
5. Vertex AIまたはOpenAI APIが使えない場合は汎用テンプレートにフォールバックする
6. UI上で編集可能なパネル一覧として表示する

製造ライン・設備保全の共通KPI:

- `Overall Equipment Effectiveness`: 設備総合効率をGaugeで表示
- `Availability / Uptime`: 現在のライン稼働率をStatで表示
- `Unplanned Downtime`: 直近の計画外停止時間をStatで表示
- `Active Alarm Count`: 未解決アラーム件数をStatで表示
- `Maintenance Action Queue`: 優先度、設備、状態、推奨対応、担当、期限をTableで表示
- `Production Loss Breakdown`: 停止、段取り、速度低下、品質ロスの構成比をドーナツで表示
- `Shift Production Summary`: シフト別の計画数、実績数、不良数、停止時間、達成率をTableで表示
- `Quality Defect Trend`: 時間帯ごとの不良率推移を時系列で表示
- `Top Defect Reasons`: 主要な不良理由の件数構成をドーナツで表示
- `MTBF / MTTR Trend`: 平均故障間隔と平均復旧時間の推移を時系列で表示

### 6.1.1 提案メモ出力

パネル案作成後、`提案メモ印刷` からブラウザ印刷用の提案メモを別ウィンドウで表示する。

出力内容:

- 顧客/案件ラベル
- 営業担当者
- 業種/監視対象
- Dashboard UID
- Dashboard folder
- 想定URL
- パネル一覧、可視化方式、単位、値範囲、Warning/Critical閾値、目的

ブラウザの印刷機能からPDF保存できる。専用PDF生成ライブラリは使用しない。

### 6.2 既知業種テンプレート

製造ライン・設備保全:

- 板金加工業者
- プレス加工業者
- 表面処理業者
- 半導体関連製造業者
- 自動車部品製造業者
- 化学製造業者
- 医薬品製造業者
- 射出成形業者
- 食品加工業者

IoTデバイス監視:

- 電力監視IoTデバイス
- 物流倉庫IoT

### 6.3 未知業種AI生成

未知業種の場合、Vertex AI Geminiに対してJSON schema付きでパネル案生成を依頼する。`AI_PROVIDER=openai` を指定した場合のみOpenAI APIを使用する。

生成条件:

- 5から10個のパネルを生成
- 製造ライン・設備保全では、AI生成後に共通KPI行を追加するため、最終的な表示パネル数は10個を超える場合がある
- Grafanaで扱える可視化種別のみ許可
- 生成結果はサーバー側で検証・正規化
- 異常な値や不足項目は既定値で補正

許可する可視化種別:

- `timeseries`
- `stat`
- `gauge`
- `piechart`
- `table`

### 6.4 パネル編集

ユーザーはUI上で以下を編集できる。

- パネル名
- 可視化方式
- 単位
- 最新値のみ表示するか
- 最小値
- 最大値
- Warning 閾値
- Critical 閾値
- 目的

また、パネルの追加と削除ができる。

### 6.4.1 作成前バリデーション

UIとサーバーの両方で、Grafana Cloudへ投入する前にパネル案を検証する。

検証項目:

- パネル数が1以上24以下であること
- パネル名が空ではなく、80文字以内であること
- 可視化方式が `timeseries` / `stat` / `gauge` / `piechart` / `table` のいずれかであること
- 最小値と最大値が数値であり、最大値が最小値より大きいこと
- Warning / Critical 閾値が入力されている場合は数値であること
- 実際に使われるWarning閾値がCritical閾値より小さいこと
- Warning / Critical 閾値が最小値と最大値の範囲内であること

UIではエラーがあるパネルに検証メッセージを表示し、`Grafana Cloud に作成` ボタンを無効化する。サーバー側でも同じ検証を行い、不正なリクエストはHTTP 400で拒否する。

### 6.5 生成前プレビュー

パネル案作成後、Grafana Cloudに作成する前に、UI上でダッシュボードの簡易レイアウトプレビューを表示する。

プレビュー仕様:

- Grafanaと同じ24カラム相当の配置で表示する
- Grafanaのダークテーマに近いパネル枠、グリッド、凡例、Stat背景色、Gauge、ドーナツ、Tableを簡易描画する
- `stat` / `gauge` は小型パネルとして表示する
- `timeseries` でタイトルに `trend` を含むものは横長パネルとして表示する
- その他のパネルは標準サイズとして表示する
- パネル名、可視化方式、単位、Warning/Critical閾値を表示する
- パネル編集、追加、削除、Dashboard folder変更に応じて即時更新する

### 6.6 ダッシュボード作成

`Grafana Cloud に作成` ボタン押下時、以下を実行する。

1. Dashboard folder選択値を取得する
2. 編集済みパネル案を検証する
3. `testdata` datasourceの存在を確認する
4. 存在しない場合はTestData datasourceを作成する
5. 編集済みパネル案からGrafana dashboard JSONを生成する
6. Grafana Cloud HTTP API `/api/dashboards/db` へPOSTする
7. 作成されたダッシュボードURLをUIに表示する

運用補助として、Cloud Run上の同じAPIを呼び出す `scripts/create-manufacturing-demo-dashboard.ps1` を用意する。このスクリプトはアクセスコードを環境変数またはSecret Managerから取得し、製造向けデモダッシュボードを作成/更新する。

例:

```powershell
.\scripts\create-manufacturing-demo-dashboard.ps1 `
  -Industry "板金加工業者" `
  -DashboardType manufacturing `
  -Overwrite
```

この例では `sheet-metal-maintenance-demo` を更新し、先頭にOEE、稼働率、計画外停止、アラーム件数の共通KPIを持つダッシュボードを作成する。

### 6.7 上書き制御

UIには `既存ダッシュボードを上書きする` チェックボックスを持つ。

- チェックあり:
  - 既存UIDのダッシュボードを上書きする
- チェックなし:
  - 同じUIDが存在しない場合は通常作成
  - 同じUIDが存在する場合は `_1`, `_2` のように連番を付けて新規作成する

例:

```text
sheet-metal-maintenance-demo
sheet-metal-maintenance-demo_1
sheet-metal-maintenance-demo_2
```

### 6.8 AndroidセンサーAI故障診断

Androidスマホを振動センサーとして使うデモでは、Cloud Run APIに蓄積された直近データから保全向けの故障兆候を判定する。

判定対象:

- 振動加速度の平均、最大値、標準偏差
- タップまたは衝撃イベント数
- 通信停止またはデータ鮮度
- バッテリー残量

判定方式:

1. サーバー側のルールで `riskScore` と `riskLevel` を計算する
2. Vertex AI GeminiまたはOpenAI APIで日本語の保全コメントを生成する
3. AI呼び出しに失敗した場合はルール判定ベースの固定コメントを返す
4. Grafanaの短周期更新でAI費用が増えないよう、AIコメントは `AI_ANALYSIS_CACHE_TTL_MS` の間キャッシュする

Grafana Cloudでは、Infinity datasourceから `/api/ai/failure-risk` を読み、`AI Maintenance Insight` パネルに表示する。

### 6.9 AIログ解析

Cloud Runアプリ内で、営業デモ中の主要イベントをメモリ上に保持し、生成AIで要約・原因候補・対応案を生成する。

記録対象:

- パネル案作成
- Grafana Cloudへのダッシュボード作成
- Androidセンサー受信
- AI故障診断
- AIログ解析
- APIエラー

このMVPではGoogle Cloud Loggingを直接読み込まない。Cloud Runインスタンスのメモリ上に保持するため、インスタンス再起動時にログは消える。本番化する場合はCloud Logging、BigQuery、Cloud Storage、または外部ログ基盤への保存を検討する。

### 6.10 デモセンサーデータ生成

Android実機がない場合でも営業デモを成立させるため、Cloud Run上でAndroid振動センサー風の時系列データを生成できる。

生成モード:

- `normal`: 安定した波形
- `warn`: 振動上昇と軽微な衝撃イベント
- `critical`: 高い振動、衝撃イベント、終盤のWARN通信状態

生成されたデータは `/api/mobile-sensor/history`、`/api/mobile-sensor/latest`、`/api/ai/failure-risk`、Grafana CloudのAndroidデモダッシュボードから参照できる。

デモ開始前に `/api/mobile-sensor/reset` を実行すると、指定Device IDまたは全デバイスのメモリ上データを削除できる。リセット時はAI診断キャッシュも削除する。

営業デモでは `/api/mobile-sensor/demo-scenario` を使うと、リセット、データ生成、AI故障診断を1回の操作で実行できる。

## 7. API仕様

### 7.0 `GET /api/ping`

Cloud RunやローカルNode.jsサーバーが起動していることだけを確認する。Grafana Cloud Tokenは不要。

レスポンス例:

```json
{
  "ok": true,
  "service": "grafana-dashboard-builder",
  "time": "2026-07-10T00:00:00.000Z"
}
```

### 7.0.1 `GET /api/runtime-status`

秘密情報の値を返さずに、実行時設定とメモリ上の状態を確認する。

主な項目:

- Grafana URL
- Grafana token設定有無
- アクセスコード有効/無効
- AI provider
- Vertex/OpenAI設定有無
- レート制限設定
- アプリ内イベント数、センサー点数、作成履歴件数

### 7.1 `GET /api/health`

Grafana Cloudへの接続状態を確認する。Grafana Cloud APIまで確認するため、Grafana tokenが未設定または無効な場合は失敗する。

レスポンス例:

```json
{
  "ok": true,
  "grafana": {
    "database": "ok",
    "version": "13.1.0"
  },
  "grafanaUrl": "https://ytsutsumi30.grafana.net"
}
```

### 7.2 `GET /api/folders`

Grafana CloudのDashboard folder一覧を取得する。

レスポンス例:

```json
{
  "ok": true,
  "folders": [
    {
      "uid": "",
      "title": "General / ルート",
      "id": 0
    }
  ]
}
```

### 7.3 `POST /api/propose`

業種・種別に応じたパネル案を作成する。

リクエスト例:

```json
{
  "industry": "板金加工業者",
  "dashboardType": "manufacturing"
}
```

レスポンス項目:

| 項目 | 内容 |
| --- | --- |
| `industry` | 入力業種 |
| `dashboardType` | `manufacturing` または `iot` |
| `source` | `template`, `ai`, `fallback` |
| `dashboardUid` | 作成予定UID |
| `dashboardSlug` | Grafana URL用slug |
| `dashboardTitle` | ダッシュボードタイトル |
| `time` | Grafana time range |
| `panels` | パネル案配列 |

### 7.4 `POST /api/create-dashboard`

Grafana Cloudにダッシュボードを作成する。

リクエスト例:

```json
{
  "industry": "板金加工業者",
  "dashboardType": "manufacturing",
  "folderUid": "",
  "overwrite": false,
  "panels": [
    {
      "title": "Cycle Time",
      "visualization": "timeseries",
      "unit": "s",
      "min": 18,
      "max": 75,
      "warningThreshold": 64.5,
      "criticalThreshold": 72,
      "purpose": "加工1サイクルのばらつきと遅延を監視",
      "latestOnly": false
    }
  ]
}
```

レスポンス例:

```json
{
  "ok": true,
  "name": "sheet-metal-maintenance-demo",
  "title": "sheet-metal machine maintenance demo",
  "overwritten": false,
  "url": "https://ytsutsumi30.grafana.net/d/sheet-metal-maintenance-demo/sheet-metal-machine-maintenance-demo"
}
```

### 7.5 `POST /api/mobile-sensor/demo-data`

Android実機なしでGrafana波形とAI診断を確認するため、Cloud Runメモリ上にデモセンサーデータを生成する。

リクエスト例:

```json
{
  "deviceId": "android-demo-001",
  "mode": "warn",
  "count": 240,
  "intervalMs": 1000
}
```

レスポンス例:

```json
{
  "ok": true,
  "deviceId": "android-demo-001",
  "mode": "warn",
  "count": 240,
  "maxMagnitude": 14.8,
  "shockCount": 8
}
```

### 7.6 `POST /api/mobile-sensor/reset`

Androidセンサーのメモリ上データを削除する。

リクエスト例:

```json
{
  "deviceId": "android-demo-001"
}
```

`deviceId` を空にすると全デバイスを削除する。

レスポンス例:

```json
{
  "ok": true,
  "deviceId": "android-demo-001",
  "resetScope": "device",
  "removedPoints": 240,
  "removedDevices": 1
}
```

### 7.7 `POST /api/mobile-sensor/demo-scenario`

Android実機なしの営業デモ用に、リセット、デモ波形生成、AI故障診断をまとめて実行する。

リクエスト例:

```json
{
  "deviceId": "android-demo-001",
  "mode": "critical",
  "count": 240,
  "intervalMs": 1000,
  "windowMinutes": 10,
  "useAi": true
}
```

レスポンスには `reset`、`generated`、`analysis` を含む。

### 7.8 `GET /api/ai/failure-risk`

Grafana Infinity datasource向けに、Androidセンサーの故障兆候診断を取得する。
既定では生成AIを呼ばず、ルールベース判定のみを返す。`ai=true` を付けた場合のみ生成AIコメントを作成するが、`APP_ACCESS_TOKEN` 設定時はアクセスコードが必要になる。

クエリ例:

```text
/api/ai/failure-risk?deviceId=android-demo-001&windowMinutes=10&ai=false
```

レスポンス例:

```json
{
  "ok": true,
  "data": [
    {
      "deviceId": "android-demo-001",
      "windowMinutes": 10,
      "riskLevel": "WARN",
      "riskScore": 62,
      "sampleCount": 240,
      "maxMagnitude": 14.2,
      "shockCount": 4,
      "summary": "通常より振動変動が大きくなっています。",
      "possibleCause": "軽微な揺れ、取り付け状態の変化、周辺振動の影響が考えられます。",
      "recommendedAction": "直近トレンドを継続確認してください。",
      "aiProvider": "vertex",
      "aiCached": false
    }
  ]
}
```

### 7.9 `POST /api/ai/failure-risk`

ブラウザUIのAI故障診断デモ向けに、Androidセンサーの故障兆候診断を実行する。

リクエスト例:

```json
{
  "deviceId": "android-demo-001",
  "windowMinutes": 10,
  "useAi": true
}
```

`useAi` を `false` にすると、生成AIを呼ばずルール判定のみを返す。

### 7.10 `GET /api/logs/recent`

アプリ内イベントログを取得する。
`APP_ACCESS_TOKEN` 設定時はアクセスコードが必要になる。

クエリ例:

```text
/api/logs/recent?limit=100
```

レスポンス例:

```json
{
  "ok": true,
  "data": [
    {
      "time": "2026-07-08T10:00:00.000Z",
      "type": "dashboard_proposed",
      "level": "info",
      "message": "Proposal created by template",
      "route": "/api/propose"
    }
  ]
}
```

### 7.11 `GET /api/ai/analyze-log`

Grafana Infinity datasource向けに、アプリ内イベントログの解析結果を取得する。
既定では生成AIを呼ばず、ルールベースの要約を返す。`ai=true` を付けた場合のみ生成AIコメントを作成するが、`APP_ACCESS_TOKEN` 設定時はアクセスコードが必要になる。

クエリ例:

```text
/api/ai/analyze-log?limit=100&ai=false
```

### 7.12 `POST /api/ai/analyze-log`

ブラウザUIのAIログ解析デモ向けに、アプリ内イベントログを解析する。

リクエスト例:

```json
{
  "limit": 100,
  "useAi": true
}
```

レスポンス項目:

| 項目 | 内容 |
| --- | --- |
| `riskLevel` | `OK`, `INFO`, `WARN`, `CRITICAL` |
| `riskScore` | 0から100のリスクスコア |
| `eventCount` | 解析対象イベント数 |
| `errorCount` | エラーイベント数 |
| `summary` | ログ要約 |
| `likelyCause` | 原因候補 |
| `recommendedAction` | 推奨対応 |

### 7.13 `GET /api/dashboard-history`

営業UIで作成した直近のGrafanaダッシュボード履歴を取得する。

クエリ:

| パラメータ | 内容 |
| --- | --- |
| `limit` | 取得件数。既定値は20、最大100 |

レスポンス例:

```json
{
  "ok": true,
  "data": [
    {
      "time": "2026-07-10T00:00:00.000Z",
      "dashboardUid": "sheet-metal-maintenance-demo",
      "dashboardTitle": "sheet-metal machine maintenance demo",
      "dashboardType": "manufacturing",
      "dashboardUrl": "https://ytsutsumi30.grafana.net/d/...",
      "folderUid": "",
      "industry": "板金加工業者"
    }
  ]
}
```

この履歴は既定ではCloud Runインスタンスのメモリ上に保持するPoC機能であり、インスタンス再起動やスケールアウト時には消える。`FIRESTORE_HISTORY_ENABLED=true` の場合はFirestoreにも保存し、履歴APIはFirestoreを優先して読み込む。

営業UIでは同時にブラウザのlocalStorageにも直近30件を保存する。これにより、同じPC・同じブラウザではCloud Run再起動後でも作成済みURLを確認できる。

### 7.14 `GET /api/datasources`

Grafana Cloudに登録されているデータソース一覧を取得する。

返却項目:

| 項目 | 内容 |
| --- | --- |
| `uid` | datasource uid |
| `name` | datasource name |
| `type` | datasource type |
| `isDefault` | default datasourceかどうか |
| `access` | Grafana datasource access mode |

### 7.15 `POST /api/datasource-replacement-plan`

TestData datasourceで作成したパネル案を、本番データソースへ差し替えるための確認表を生成する。

リクエスト:

```json
{
  "datasource": {
    "uid": "grafanacloud-prom",
    "name": "Prometheus",
    "type": "prometheus"
  },
  "panels": []
}
```

レスポンスには、パネルごとの対象データソース、想定単位、値範囲、クエリ例、確認点を含む。これはクエリ自動変換ではなく、実データ化前のヒアリング・実装確認用の支援情報である。

## 8. Grafana Dashboard生成仕様

### 8.1 共通設定

| 項目 | 値 |
| --- | --- |
| datasource uid | `testdata` |
| datasource type | `grafana-testdata-datasource` |
| refresh | `5s` |
| timezone | `browser` |
| schemaVersion | `41` |
| tags | `codex`, `sales-demo`, `manufacturing`, `iot`, `maintenance` |

### 8.1.1 閾値

各パネルには以下の閾値を設定できる。

| 項目 | 内容 |
| --- | --- |
| `warningThreshold` | Grafana上で黄色表示に切り替える値 |
| `criticalThreshold` | Grafana上で赤表示に切り替える値 |

テンプレートまたはAI生成結果に閾値がない場合、サーバー側で値範囲から自動算出する。

- 温度、電流、騒音、振動: Warning 75%、Critical 90%
- その他: Warning 80%、Critical 最大値

編集された閾値はGrafana dashboard JSONの `fieldConfig.defaults.thresholds.steps` に反映する。

### 8.2 時間範囲

- 製造ライン・設備保全: `now-6h` to `now`
- 電力監視IoT: `now-30d` to `now`

### 8.3 パネル配置

24カラムグリッドで自動配置する。

- `stat` / `gauge`: 幅8、高さ5
- `timeseries` かつタイトルに `trend` を含む: 幅24、高さ9
- その他: 幅12、高さ8

### 8.4 TestData利用

通常のセンサーデータは `random_walk` を使用する。

以下のような固定データ表現が必要な場合は `csv_content` を使用する。

- 電力分布ドーナツ
- IoTデバイス通信状態テーブル
- 日別電力推移の固定デモデータ

### 8.5 Androidセンサー / AIデモダッシュボード

Android振動センサーデモ用の `android-vibration-sensor-demo` は、TestDataではなくGrafana CloudのInfinity datasourceを使用する。

Datasource:

```text
grafanacloud-infinity
```

Cloud Run JSON API:

- `/api/mobile-sensor/latest`
- `/api/mobile-sensor/history`
- `/api/ai/failure-risk`
- `/api/ai/analyze-log`

AI関連パネル:

- `AI Maintenance Insight`: センサー履歴から故障兆候、原因候補、推奨対応を表示
- `AI App Log Analysis`: アプリ内イベントログからデモ運用状態、エラー傾向、推奨対応を表示

## 9. セキュリティ仕様

### 9.1 認証情報

ブラウザにはGrafana Cloud TokenやAI API認証情報を渡さない。

認証情報は以下のいずれかでサーバー側に設定する。

- ローカル環境変数
- Cloud Run + Secret Manager

### 9.2 Cloud Run

PoCでは `allUsers` に `roles/run.invoker` を付与して一般公開できる。

一般公開PoCでは、`APP_ACCESS_TOKEN` を設定することで、営業UIからの書き込み・AI利用操作にアクセスコードを要求できる。

保護対象:

- `GET /api/health`
- `GET /api/runtime-status`
- `GET /api/folders`
- `GET /api/datasources`
- `GET /api/dashboard-history`
- `GET /api/logs/recent`
- `GET /api/ai/failure-risk?ai=true`
- `GET /api/ai/analyze-log?ai=true`
- `POST /api/propose`
- `POST /api/datasource-replacement-plan`
- `POST /api/create-dashboard`
- `POST /api/mobile-sensor/demo-data`
- `POST /api/mobile-sensor/reset`
- `POST /api/mobile-sensor/demo-scenario`
- `POST /api/ai/failure-risk`
- `POST /api/ai/analyze-log`

Grafana CloudのInfinity datasourceが読み取る公開JSON APIと、Androidアプリのセンサー送信APIは、デモ連携維持のためアクセスコード対象外とする。
ただし、公開GETのAI診断APIは既定でルールベース判定のみを返し、生成AIモデルは呼び出さない。

レート制限対象:

- `POST /api/propose`
- `POST /api/create-dashboard`
- `POST /api/mobile-sensor/demo-data`
- `POST /api/mobile-sensor/reset`
- `POST /api/mobile-sensor/demo-scenario`
- `POST /api/ai/failure-risk`
- `POST /api/ai/analyze-log`

制限超過時はHTTP 429と `RATE_LIMIT_EXCEEDED` を返す。

ただし、アプリ内アクセスコードは簡易的なPoC保護であり、本番利用では以下を推奨する。

- Cloud Run IAMで利用者を限定
- IAPでGoogleログイン認証を追加
- 社内ネットワークまたはVPN経由に制限

IAP配下で実行した場合、`X-Goog-Authenticated-User-Email` または `X-Forwarded-Email` ヘッダーがあれば、主要な操作イベントに `actor` として記録する。

### 9.3 Secret Manager

Cloud Runでは以下のsecretを使用する。

- `grafana-service-account-token`
- `grafana-dashboard-builder-access-token` 任意。一般公開PoCでアクセスコードを使う場合

Cloud Run専用サービスアカウントに対し、上記secretのみ `roles/secretmanager.secretAccessor` を付与する。

Vertex AI Gemini利用時は、Cloud Run専用サービスアカウントに `roles/aiplatform.user` を付与する。

## 10. デプロイ仕様

### 10.1 Docker

ファイル: `Dockerfile`

- ベースイメージ: `node:22-slim`
- 起動コマンド: `node server/grafana-dashboard-builder.js`

### 10.2 Cloud Run

ファイル: `scripts/deploy-cloud-run.ps1`

主な設定:

- region: `asia-northeast1`
- service: `grafana-dashboard-builder`
- memory: `512Mi`
- cpu: `1`
- max instances: `3`
- secrets:
  - `GRAFANA_SERVICE_ACCOUNT_TOKEN=grafana-service-account-token:latest`
- env:
  - `AI_PROVIDER=vertex`
  - `VERTEX_AI_PROJECT=<GCP Project ID>`
  - `VERTEX_AI_LOCATION=global`
  - `VERTEX_AI_MODEL=gemini-2.5-flash-lite`

## 11. 現在のPoC環境

| 項目 | 値 |
| --- | --- |
| GCP Project ID | `modern-replica-465803-n8` |
| Cloud Run service | `grafana-dashboard-builder` |
| Region | `asia-northeast1` |
| Service URL | `https://grafana-dashboard-builder-pjvjufzh3q-an.a.run.app` |
| Grafana Cloud URL | `https://ytsutsumi30.grafana.net` |
| 公開状態 | `allUsers` に `roles/run.invoker` 付与済み |

## 12. 制約事項

- 作成されるデータはTestData datasourceによるモックであり、実データではない
- AI生成結果は営業デモ向けの案であり、実際の顧客設備仕様とは照合が必要
- 一般公開状態では第三者がダッシュボードを作成できる可能性がある
- 現状、ユーザー認証・操作履歴・承認フローはアプリ側に実装していない
- 生成前プレビューはGrafana風の簡易描画であり、Grafana本体の完全なレンダリング画像ではない

## 13. 今後の拡張候補

- IAP強制やアプリ独自ログインによるアクセス制御
- 提案メモのサーバー側PDF生成
