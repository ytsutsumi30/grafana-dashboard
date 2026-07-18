# 専門エージェント運用定義

## 構成

| 役割 | 定義 | 主な責任 |
| --- | --- | --- |
| 統括 | `.agents/orchestrator.md` | 優先順位、統合、リリース、最終判断 |
| Grafana | `.agents/grafana-specialist.md` | Dashboard JSON、データソース、Grafana API |
| 認証/API | `.agents/auth-api-specialist.md` | Cloud Run、OIDC、Secret Manager、Firestore |
| Android | `.agents/android-specialist.md` | センサーアプリ、Google Sign-In、APK、実機デモ |
| UI/QA | `.agents/ui-qa-specialist.md` | UI、プレビュー、アクセシビリティ、回帰検証 |

## 作業フロー

1. 統括エージェントが要件、受入基準、変更ファイル、デプロイ有無を決定する。
2. 変更領域ごとに専門エージェントが調査、実装案、検証結果を提出する。
3. 同じファイルまたはクラウド設定を扱う作業は直列化する。
4. 統括エージェントが差分、テスト、本番影響、ロールバックを確認して統合する。
5. 本番変更後は認証/API と UI/QA がそれぞれ API 境界とユーザー画面を検証する。

## 標準依頼形式

各エージェントへの依頼には次を含める。

```text
担当: <役割>
目的: <利用者にとっての結果>
対象: <ファイル、URL、クラウドリソース>
変更禁止: <他領域または秘密値>
受入基準: <API、UI、テスト、URL>
本番変更: あり/なし
```

## 境界

- Grafana Cloud の dashboard 作成は Grafana 担当が行い、認証/API 担当が API の公開範囲を確認する。
- Cloud Run デプロイと IAM/Secret Manager の変更は統括が一本化する。
- Android の API 契約変更は Android と認証/API の合意後に実施する。
- UI の変更は UI/QA が検証するが、認証やデータ契約は単独で変更しない。

## 必須ゲート

- 秘密値、IAM、OAuth、公開アクセス、データ保持の変更はユーザー承認を得る。
- 本番リリース前に `git diff --check`、関連テスト、Cloud Run の health/auth API を確認する。
- UI 変更前後に dev server、対象画面、console error 0 件、関連テストを確認する。
