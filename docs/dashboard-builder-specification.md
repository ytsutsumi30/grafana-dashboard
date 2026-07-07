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
| `AI_PROVIDER` | 任意 | `vertex` | `vertex` または `openai` |
| `VERTEX_AI_PROJECT` | Vertex利用時必須 | なし | Vertex AIを呼び出すGCP Project ID |
| `VERTEX_AI_LOCATION` | 任意 | `global` | Vertex AIのロケーション |
| `VERTEX_AI_MODEL` | 任意 | `gemini-2.5-flash-lite` | パネル案生成に使うGeminiモデル |
| `OPENAI_API_KEY` | OpenAI利用時必須 | なし | OpenAI APIを使う場合のAPIキー |
| `OPENAI_MODEL` | 任意 | `gpt-4.1-mini` | OpenAIを使う場合のモデル |
| `AI_ANALYSIS_CACHE_TTL_MS` | 任意 | `60000` | センサー故障診断AIコメントのキャッシュ時間 |
| `APP_LOG_MAX_EVENTS` | 任意 | `500` | アプリ内イベントログの最大保持件数 |

`GRAFANA_SERVICE_ACCOUNT_TOKEN` と `GRAFANA_CLOUD_TOKEN` の両方が設定されている場合、`GRAFANA_SERVICE_ACCOUNT_TOKEN` を優先する。

## 6. 機能仕様

### 6.1 パネル案作成

ユーザーは以下を入力・選択する。

- 業種または監視対象
- ダッシュボード種別
  - 製造ライン・設備保全
  - IoTデバイス監視
- Dashboard folder

パネル案作成時の動作:

1. 入力された業種とダッシュボード種別をサーバーへ送信する
2. 既知業種に該当する場合はテンプレートを返す
3. 未知業種の場合は標準でVertex AI Geminiによりパネル案を生成する
4. Vertex AIまたはOpenAI APIが使えない場合は汎用テンプレートにフォールバックする
5. UI上で編集可能なパネル一覧として表示する

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
2. `testdata` datasourceの存在を確認する
3. 存在しない場合はTestData datasourceを作成する
4. 編集済みパネル案からGrafana dashboard JSONを生成する
5. Grafana Cloud HTTP API `/api/dashboards/db` へPOSTする
6. 作成されたダッシュボードURLをUIに表示する

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

## 7. API仕様

### 7.1 `GET /api/health`

Grafana Cloudへの接続状態を確認する。

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

### 7.5 `GET /api/ai/failure-risk`

Grafana Infinity datasource向けに、Androidセンサーの故障兆候診断を取得する。

クエリ例:

```text
/api/ai/failure-risk?deviceId=android-demo-001&windowMinutes=10
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

### 7.6 `POST /api/ai/failure-risk`

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

### 7.7 `GET /api/logs/recent`

アプリ内イベントログを取得する。

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

### 7.8 `GET /api/ai/analyze-log`

Grafana Infinity datasource向けに、アプリ内イベントログのAI解析結果を取得する。

クエリ例:

```text
/api/ai/analyze-log?limit=100
```

### 7.9 `POST /api/ai/analyze-log`

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

ただし、URLを知っているユーザーがGrafana Cloudにダッシュボードを作成できるため、本番利用では以下を推奨する。

- Cloud Run IAMで利用者を限定
- IAPでGoogleログイン認証を追加
- 社内ネットワークまたはVPN経由に制限

### 9.3 Secret Manager

Cloud Runでは以下のsecretを使用する。

- `grafana-service-account-token`

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

- 顧客名・案件名・営業担当者名の入力
- 作成履歴の保存
- Grafana実データソースへの差し替え支援
- IAPまたはアプリ独自ログインの追加
- PDF提案書出力
