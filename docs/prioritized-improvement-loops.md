# 優先改善ループ実施台帳

## 1. 運用ルール

各課題は最大10反復で処理する。1反復は `現状確認 -> 最小変更 -> 機械検証 -> 独立検証 -> 判定` とする。

完了条件:

- 仕様がコードとドキュメントに反映されている
- 対象テストと既存の関連テストが成功する
- UI変更ではdev server、対象画面、console error 0件、desktop/mobile表示を確認する
- 独立した専門エージェントがP0/P1なしと判定する

停止・承認条件:

- 10反復で完了しない場合は未解決事項と必要な人判断を記録する
- 本番データ削除、公開範囲変更、Cloud Runトラフィック切替は人の承認点とする
- Secret値をログ、テスト結果、Git差分へ出力しない

## 2. 実施結果

| No. | 課題 | 状態 | 反復 | 主な完了判定 |
| --- | --- | --- | --- | --- |
| 1 | 閾値の異常方向 | 完了 | 2/10 | high/low/outsideがUI、API、Grafana JSONで一致 |
| 2 | TestDataの固定日時解消 | 完了 | 1/10 | 実行時基準のモック時系列を生成 |
| 3 | 認証設定のフェイルクローズとallowlist必須化 | 完了 | 2/10 | Cloud Runの不完全設定を起動前に拒否 |
| 4 | 静的セットアップの上書き防止 | 完了 | 1/10 | 明示指定なしで既存UIDを更新しない |
| 5 | APIタイムアウト・入力検証・冪等性 | 完了 | 4/10 | timeout、schema、共有冪等性を検証 |
| 6 | Androidセンサー集約とオフライン再送 | 完了 | 2/10 | 集約、永続FIFO、指数再送を検証 |
| 7 | mobile導線、認証エラー、アクセシビリティ | 完了 | 2/10 | mobile操作、認証復旧、読み上げを検証 |
| 8 | イミュータブルなCloud Runリリース | 完了 | 2/10 | digest固定、候補検証、明示昇格 |
| 9 | センサーデータ永続化 | 完了 | 3/10 | Firestore、再送、reset、latest整合性 |
| 10 | 公開APIと管理APIのサービス分離 | 完了 | 3/10 | role、route、secret、rate limitを分離 |

## 3. 課題別記録

### 課題1: 閾値の異常方向

- `riskDirection=high|low|outside`をUI、AI schema、サーバー、Grafana thresholdへ追加
- AI応答の方向別閾値順序もサーバー共通検証へ追加
- `node scripts/verify-risk-direction.js`: 成功
- 独立Grafana再検証: PASS

### 課題2: TestDataの固定日時解消

- CSVを`__NOW__` / `__NOW_MINUS_*__` tokenで保持し、投入時にUTCへ変換
- 固定ISO日時をリポジトリ検証で拒否
- `node scripts/verify-relative-testdata-time.js`: 成功
- 独立Grafana検証: PASS

### 課題3: 認証のフェイルクローズ

- Cloud Runの`none`、OIDC Client ID不足、allowlist不足、access token不足を拒否
- IAP認証メールにも同じallowlistを適用
- `verify-auth-fail-closed.js` / `verify-google-oidc-mode.js`: 成功
- 独立認証/API再検証: PASS

### 課題4: 静的セットアップ上書き防止

- 静的JSONを`overwrite:false`とし、既存UIDは`OVERWRITE_DASHBOARD=true`時だけ更新
- `node scripts/verify-static-dashboard-import-policy.js`: 成功
- 独立Grafana検証: PASS

### 課題5: API安全性と冪等性

- 外部HTTP timeout、JSON byte/content-type/object検証、主要入力範囲検証を共通化
- ダッシュボード作成は`Idempotency-Key`必須、Cloud RunはFirestore原子claimを使用
- 完了記録失敗時はclaimを保持し、重複副作用を防止
- `verify-api-safety.js` / `verify-persistent-idempotency.js`: 成功
- 独立認証/API再検証: PASS

### 課題6: Android集約とオフライン再送

- 平均XYZ、RMS、peak、sample count、shock ORを送信窓で集約
- UUID event ID、SharedPreferences FIFO、成功後削除、1-60秒指数バックオフを実装
- `testDebugUnitTest` / `assembleDebug` / ASCII検査: 成功
- 独立Android再検証: PASS

### 課題7: mobile導線・認証エラー・アクセシビリティ

- mobile下部工程ナビ、skip link、section focus、フォームlabel関連付けを追加
- 401でOIDC credentialを破棄し再ログイン表示、auth-status失敗はfail closed
- AndroidをScrollView化し、画面全体tap捕捉と高頻度live regionを廃止
- dev server、desktop/mobile、console error 0件、Android build: 成功
- 独立UI/QA再検証: PASS

### 課題8: イミュータブルCloud Runリリース

- Cloud Build固有tagからdigestを解決し、digest固定で`--no-traffic`候補revisionを作成
- 昇格は既存Release ID、必須ExpectedImageDigest、tagとrevisionの一致、Ready/healthを再検証
- Release IDの正規化・切り詰めを廃止して衝突入力を拒否
- `node scripts/verify-immutable-cloud-run-release.js`: 成功
- 独立認証/API再検証: PASS
- 本番トラフィック変更: 未実施

### 課題9: センサーデータ永続化

- Firestoreへevent ID単位で履歴とlatestを保存し、TTL用`expiresAt`を設定
- 書き込み失敗は503でAndroid再送、読み取り失敗はwarning付きメモリfallback
- latestはFirestore updateTime preconditionで巻き戻りを防止
- resetは450件単位で空になるまで削除し、競合・失敗claimは安全時だけ解放
- `node scripts/verify-firestore-sensor-persistence.js`: 成功
- 独立認証/API再検証: PASS

### 課題10: 公開APIと管理APIのサービス分離

- `SERVICE_ROLE=public|admin|combined`を追加し、Cloud Runのcombinedを拒否
- publicはAndroid受信とGrafana監視GETだけ、adminはUIと管理APIだけを許可
- public roleへのGrafana/OpenAI secret注入を起動時に拒否
- public/adminでCloud Run service、service account、rate limit、revisionを別管理
- `verify-service-role-separation.js`、PowerShell構文、全UI検証: 成功
- 1回目: 専用IAM強制、public rollback、認証説明にP1
- 2回目: secret IAM policy検査失敗の無視にP1
- 3回目: 専用service account/name、IAM fail closed、両service rollback、文書整合を実装
- 独立認証/API再検証: PASS

## 4. 共通最終検証

- `node scripts/verify-ui-change-loop.js`: 成功
- dev server: 起動成功
- desktop/mobile対象画面: 成功
- browser console error: 0件
- 関連Nodeテストとdashboard JSON検証: 成功
- Android unit test / debug APK build: 成功
- Cloud Run本番deploy / traffic切替: 未実施
